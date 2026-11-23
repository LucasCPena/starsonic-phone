// Os servidores do teste vistos pelos testes: os endereços, a página de administração do chat (a reunião de teste e a
// preparação do ambiente.ts), a API do chat como um computador (o app da Ana, com os eventos do WebSocket dele) e o
// que os testes anotam para conferir os registros no fim.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repetirAte } from './espera';

// --- Os endereços e as pastas ----------------------------------------------------------------------------------------

// O cliente mínimo (estatico.mjs). Não na 4190: ela está na lista das portas que o padrão do fetch proíbe (a do
// ManageSieve), e o Chromium recusa a página (ERR_UNSAFE_PORT), como o fetch do Node ("bad port").
export const PAGINA = 'http://127.0.0.1:4192';
export const CHAT = 'http://127.0.0.1:4191';
export const AGENTE = 'http://127.0.0.1:8095';

/** As origens que o /sip do agente aceita no teste (o --origem): o cliente mínimo e a página da reunião, que o chat
 * serve em /r/<código>. */
export const ORIGENS_DO_SIP = [PAGINA, CHAT];

export const RAIZ = fileURLToPath(new URL('./', import.meta.url));
/** As saídas: os registros dos servidores ficam aqui, e o Playwright usa a subpasta saida/. */
export const SAIDA = join(RAIZ, 'test-results');
/** O que nunca sobe como artefato: o config.json (a chave e a senha do ESL), a configuração do FreeSWITCH, os dados
 * do chat e os programas compilados. */
export const PRIVADO = join(SAIDA, 'privado');

/** Os arquivos de saída de cada servidor. */
export const REGISTROS = {
  freeswitch: join(SAIDA, 'freeswitch.log'),
  agente: join(SAIDA, 'agente.log'),
  chat: join(SAIDA, 'chat.log'),
  estatico: join(SAIDA, 'estatico.log'),
};

/** Os nomes inventados das pessoas do teste. */
export const NOMES = ['Ana Souza', 'Carlos Lima', 'Maria Lima', 'Bia Ramos', 'Roberto Alves'];

/** O IPv4 da máquina que não é de loopback: o do perfil tls do FreeSWITCH. O ambiente.ts o escolhe, ou usa o do
 * STARSONIC_E2E_IP quando ele vem dado. */
export function ipDaMaquina(): string {
  const ip = process.env.STARSONIC_E2E_IP;
  if (!ip) throw new Error('falta o STARSONIC_E2E_IP (o ambiente.ts não rodou)');
  return ip;
}

// --- O que os testes anotam ----------------------------------------------------------------------------------------

// Os códigos, as salas, os participantes, as senhas, os bilhetes, as chaves de volta, os passes e as chaves do colega
// e os textos das mensagens do chat da reunião que passaram pelos testes, para o teste dos registros e a conferência do fim. Ficam num arquivo da pasta
// privada: um teste que falha troca o processo do Playwright, e o último teste ainda os vê.
const USADOS = join(PRIVADO, 'usados.jsonl');

type Tipo =
  | 'codigos'
  | 'salas'
  | 'participantes'
  | 'senhas'
  | 'bilhetes'
  | 'voltas'
  | 'passes'
  | 'chaves'
  | 'chavesDoColega'
  | 'textos';

/** O texto de uma mensagem do chat da reunião é anotado com 12 letras ou mais: um texto curto ("Oi") apareceria nas
 * saídas por acaso. Os testes mandam textos únicos e compridos. */
const MIN_DO_TEXTO = 12;

function anotar(tipo: Tipo, valor: string): void {
  appendFileSync(USADOS, `${JSON.stringify({ tipo, valor })}\n`);
}

const CODIGO = /^[abcdefghjkmnpqrstvwxyz23456789]{10}$/;
const CHAVE = /^[A-Za-z0-9_-]{43}$/;

/** A carga de uma senha de uso único (<carga>.<assinatura>), ou null. */
function cargaDe(senha: string): { sala?: unknown; participante?: unknown } | null {
  const [carga, assinatura] = senha.split('.');
  if (!carga || !assinatura) return null;
  try {
    return JSON.parse(Buffer.from(carga, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/** Anota o que houver no valor (um Acesso, uma mensagem da página, um evento, uma lista, uma resposta): os códigos das
 * reuniões, as senhas, a sala e o participante de dentro de cada senha, os bilhetes (o da página e o dos eventos do
 * app), as chaves de volta da página, os passes do colega (o campo passe), as chaves de 43 caracteres (a de um
 * computador; a do colega, o colega.chave da resposta do abrir, também como chavesDoColega) e os textos das mensagens
 * do chat da reunião (o campo texto). */
export function anotarSegredos(valor: unknown): void {
  if (Array.isArray(valor)) {
    valor.forEach(anotarSegredos);
    return;
  }
  if (valor === null || typeof valor !== 'object') return;
  for (const [campo, v] of Object.entries(valor)) {
    if (typeof v === 'string') {
      if ((campo === 'codigo' || campo === 'reuniao') && CODIGO.test(v)) anotar('codigos', v);
      if (campo === 'participante' && /^[0-9a-f]{16}$/.test(v)) anotar('participantes', v);
      if (campo === 'bilhete' && v !== '') anotar('bilhetes', v);
      if (campo === 'volta' && v !== '') anotar('voltas', v);
      if (campo === 'passe' && v !== '') anotar('passes', v);
      if (campo === 'chave' && CHAVE.test(v)) anotar('chaves', v);
      if (campo === 'texto' && [...v].length >= MIN_DO_TEXTO) anotar('textos', v);
      if (campo === 'senha' && v !== '') {
        anotar('senhas', v);
        const carga = cargaDe(v);
        if (typeof carga?.sala === 'string') anotar('salas', carga.sala);
        if (typeof carga?.participante === 'string') anotar('participantes', carga.participante);
      }
    } else {
      const chave = (v as { chave?: unknown } | null)?.chave;
      if (campo === 'colega' && typeof chave === 'string' && CHAVE.test(chave)) anotar('chavesDoColega', chave);
      anotarSegredos(v);
    }
  }
}

/** O que os testes anotaram, sem repetir. */
export function segredosUsados(): Record<Tipo, string[]> {
  const usados: Record<Tipo, Set<string>> = {
    codigos: new Set(),
    salas: new Set(),
    participantes: new Set(),
    senhas: new Set(),
    bilhetes: new Set(),
    voltas: new Set(),
    passes: new Set(),
    chaves: new Set(),
    chavesDoColega: new Set(),
    textos: new Set(),
  };
  if (existsSync(USADOS)) {
    for (const linha of readFileSync(USADOS, 'utf8').split('\n')) {
      if (!linha) continue;
      const { tipo, valor } = JSON.parse(linha) as { tipo: Tipo; valor: string };
      usados[tipo].add(valor);
    }
  }
  return {
    codigos: [...usados.codigos],
    salas: [...usados.salas],
    participantes: [...usados.participantes],
    senhas: [...usados.senhas],
    bilhetes: [...usados.bilhetes],
    voltas: [...usados.voltas],
    passes: [...usados.passes],
    chaves: [...usados.chaves],
    chavesDoColega: [...usados.chavesDoColega],
    textos: [...usados.textos],
  };
}

/** Os segredos do ambiente, que nunca passam por um teste: a chave do agente e a senha do ESL (do config.json da pasta
 * privada), a senha da administração do chat e a chave do computador da Ana (o ambiente.ts as põe no process.env). */
export function segredosDoAmbiente(): Array<[string, string]> {
  const config = JSON.parse(readFileSync(join(PRIVADO, 'config.json'), 'utf8')) as { chave: string; senhaEsl: string };
  const segredos: Array<[string, string | undefined]> = [
    ['a chave do agente', config.chave],
    ['a senha do ESL', config.senhaEsl],
    ['a senha da administração', process.env.CHAT_ADMIN_SENHA],
    ['a chave do computador da Ana', process.env.STARSONIC_E2E_ANA],
  ];
  for (const [rotulo, valor] of segredos) {
    if (!valor) throw new Error(`falta ${rotulo} (o ambiente.ts não rodou)`);
  }
  return segredos as Array<[string, string]>;
}

/** A senha do ESL do ambiente (do config.json da pasta privada). Só para abrir o ESL: nunca numa mensagem, no console
 * ou num arquivo. */
export function senhaDoEsl(): string {
  const { senhaEsl } = JSON.parse(readFileSync(join(PRIVADO, 'config.json'), 'utf8')) as { senhaEsl?: string };
  if (!senhaEsl) throw new Error('falta a senha do ESL (o ambiente.ts não rodou)');
  return senhaEsl;
}

/** O que os registros têm e não podiam ter: um nome, um código de reunião, uma sala, um participante, uma senha, um
 * bilhete, uma chave de volta, um passe, uma chave (do colega ou de um computador), o texto de uma mensagem do chat da reunião ou um segredo do ambiente, e qualquer senha
 * de uso único (a carga começa por {"v":1, em base64url), também as que os testes não viram. Cada achado diz a saída,
 * o que é e a linha, nunca o valor. */
export function segredosNosRegistros(): string[] {
  const usados = segredosUsados();
  const proibidos: Array<[string, string[]]> = [
    ['um nome', NOMES],
    ['um código de reunião', usados.codigos],
    ['uma sala', usados.salas],
    ['um participante', usados.participantes],
    ['uma senha', usados.senhas],
    ['um bilhete', usados.bilhetes],
    ['uma chave de volta', usados.voltas],
    ['um passe', usados.passes],
    ['uma chave', usados.chaves],
    ['uma chave do colega', usados.chavesDoColega],
    ['o texto de uma mensagem', usados.textos],
    ...segredosDoAmbiente().map(([rotulo, valor]): [string, string[]] => [rotulo, [valor]]),
  ];
  const achados: string[] = [];
  for (const { nome, texto } of registros()) {
    const linhas = texto.split('\n');
    for (const [rotulo, valores] of proibidos) {
      for (const valor of valores) {
        const n = linhas.findIndex((l) => l.includes(valor));
        if (n >= 0) achados.push(`a saída do ${nome} tem ${rotulo} na linha ${n + 1}`);
      }
    }
    const senha = linhas.findIndex((l) => l.includes('eyJ2IjoxL'));
    if (senha >= 0) achados.push(`a saída do ${nome} tem uma senha na linha ${senha + 1}`);
  }
  return achados;
}

/** As saídas do FreeSWITCH, do agente e do chat. */
export function registros(): Array<{ nome: string; texto: string }> {
  return [
    { nome: 'FreeSWITCH', texto: readFileSync(REGISTROS.freeswitch, 'utf8') },
    { nome: 'agente', texto: readFileSync(REGISTROS.agente, 'utf8') },
    { nome: 'chat', texto: readFileSync(REGISTROS.chat, 'utf8') },
  ];
}

// --- O agente ------------------------------------------------------------------------------------------------------

interface SalaDoAgente {
  sala: string;
  participantes: Array<{ participante: string; tela: boolean }>;
  palco?: { largura: number; altura: number; quadros: unknown[] };
}

interface EstadoDoAgente {
  salas: SalaDoAgente[];
}

/** O estado do agente (seção 5 do docs/video-agente.md), com a chave do config.json da pasta privada. */
async function estadoDoAgente(): Promise<EstadoDoAgente> {
  const { chave } = JSON.parse(readFileSync(join(PRIVADO, 'config.json'), 'utf8')) as { chave: string };
  const r = await fetch(`${AGENTE}/agente/v1/estado`, { headers: { authorization: `Bearer ${chave}` } });
  if (r.status !== 200) throw new Error(`o estado do agente respondeu ${r.status}`);
  return (await r.json()) as EstadoDoAgente;
}

/** A sala do agente, com as ligações e o último palco dela, ou null quando ela não existe (ou já acabou). */
export async function salaNoAgente(sala: string): Promise<SalaDoAgente | null> {
  const { salas } = await estadoDoAgente();
  return salas.find((s) => s.sala === sala) ?? null;
}

/** A sala de dentro de uma senha de uso único. */
export function salaDaSenha(senha: string): string {
  const sala = cargaDe(senha)?.sala;
  if (typeof sala !== 'string') throw new Error('a senha não leva uma sala');
  return sala;
}

/** O papel de dentro de uma senha de uso único: colega ou fora. */
export function papelDaSenha(senha: string): string {
  const papel = (cargaDe(senha) as { papel?: unknown } | null)?.papel;
  if (typeof papel !== 'string') throw new Error('a senha não leva um papel');
  return papel;
}

/** O aviso do agente quando o FreeSWITCH recusa um comando do mosaico (salas.go). */
const AVISO_DO_MOSAICO = 'recusou um comando do mosaico';

/** As linhas do aviso do mosaico na saída do agente até agora: só os comandos (o comando=<palavra>), que não são
 * segredo. */
export function avisosDoMosaico(): string[] {
  return readFileSync(REGISTROS.agente, 'utf8')
    .split('\n')
    .filter((l) => l.includes(AVISO_DO_MOSAICO))
    .map((l) => /comando=\S+/.exec(l)?.[0] ?? '(sem o comando)');
}

/** Quantas ligações principais (as da câmera) o participante tem nas salas do agente. */
export async function ligacoesPrincipais(participante: string): Promise<number> {
  const { salas } = await estadoDoAgente();
  return salas.flatMap((s) => s.participantes).filter((p) => p.participante === participante && !p.tela).length;
}

// --- A página de administração do chat -----------------------------------------------------------------------------

// Os cookies da sessão, na memória: uma sessão por processo (uma entrada errada conta para a trava do endereço).
const cookies = new Map<string, string>();
let sessao: Promise<void> | null = null;

function guardarCookies(r: Response): void {
  for (const c of r.headers.getSetCookie()) {
    const [par, ...atributos] = c.split(';').map((p) => p.trim());
    const i = par.indexOf('=');
    const apagar = par.slice(i + 1) === '' || atributos.some((a) => /^max-age=(0|-\d+)$/i.test(a));
    if (apagar) cookies.delete(par.slice(0, i));
    else cookies.set(par.slice(0, i), par.slice(i + 1));
  }
}

/** Um pedido à administração, com os cookies; os redirecionamentos ficam para quem chama. */
async function admin(metodo: string, caminho: string, form?: Record<string, string>): Promise<Response> {
  const r = await fetch(CHAT + caminho, {
    method: metodo,
    redirect: 'manual',
    headers: {
      cookie: [...cookies].map(([n, v]) => `${n}=${v}`).join('; '),
      ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  guardarCookies(r);
  return r;
}

/** O token do formulário (o campo escondido csrf) e o HTML da página. */
async function paginaComCsrf(caminho: string): Promise<{ csrf: string; html: string }> {
  const r = await admin('GET', caminho);
  const html = await r.text();
  const m = /name="csrf" value="([^"]+)"/.exec(html);
  if (!m) throw new Error(`a página ${caminho} veio sem o csrf (status ${r.status})`);
  return { csrf: m[1], html };
}

function entrarNaAdministracao(): Promise<void> {
  sessao ??= (async () => {
    const senha = process.env.CHAT_ADMIN_SENHA;
    if (!senha) throw new Error('falta o CHAT_ADMIN_SENHA (o ambiente.ts não rodou)');
    const { csrf } = await paginaComCsrf('/admin/entrar');
    const r = await admin('POST', '/admin/entrar', { csrf, usuario: 'teste', senha });
    if (r.status !== 303) throw new Error(`a entrada na administração respondeu ${r.status}`);
  })();
  sessao.catch(() => {
    sessao = null;
  });
  return sessao;
}

/** Um formulário da administração: o POST com o csrf de pagina. Devolve o status, o HTML e o Location da resposta. */
async function formulario(
  pagina: string,
  acao: string,
  campos: Record<string, string>,
): Promise<{ status: number; html: string; local: string }> {
  await entrarNaAdministracao();
  const { csrf } = await paginaComCsrf(pagina);
  const r = await admin('POST', acao, { csrf, ...campos });
  return { status: r.status, html: await r.text(), local: r.headers.get('location') ?? '' };
}

/** Uma reunião de teste nova (a anterior acaba): o código dela, lido do link que a página "Reuniões" mostra. */
export async function novaReuniaoDeTeste(): Promise<string> {
  const r = await formulario('/admin/reunioes', '/admin/reunioes/teste', {});
  if (r.status !== 303) throw new Error(`criar a reunião de teste respondeu ${r.status}`);
  const { html } = await paginaComCsrf('/admin/reunioes');
  const codigo = /id="codigo">[^<]*\/r\/([a-z0-9]{10})</.exec(html)?.[1];
  if (!codigo) throw new Error('a página Reuniões não mostra o link da reunião de teste');
  anotarSegredos({ codigo });
  return codigo;
}

/** A preparação do chat (o ambiente.ts): o servidor de vídeo no cartão "Reuniões", 20 reuniões ao mesmo tempo, a
 * empresa ACME com as reuniões liberadas e o computador da Ana. Devolve a chave do computador da Ana. */
export async function prepararChat(chaveDoVideo: string): Promise<string> {
  // No modo de teste, o cliente do vídeo fala HTTP e ws:// com o agente: o endereço vai com o http://.
  const servidor = await formulario('/admin/reunioes', '/admin/reunioes/servidor', { endereco: AGENTE, chave: chaveDoVideo });
  if (servidor.status !== 200 || !servidor.html.includes('O servidor de vídeo respondeu')) {
    const resultado = /<p class="(?:erro|resultado-[a-z]+)"[^>]*>([^<]+)</.exec(servidor.html)?.[1] ?? '';
    throw new Error(`o cartão Reuniões não aceitou o servidor de vídeo (status ${servidor.status}): ${resultado}`);
  }
  const limite = await formulario('/admin/reunioes', '/admin/reunioes/limite', { limite: '20' });
  if (limite.status !== 303) throw new Error(`o limite de reuniões respondeu ${limite.status}`);

  const codigoDaEmpresa = await novaEmpresa('ACME Comércio Ltda');
  // O computador da Ana Souza (2001), ligado pela API.
  const { chave } = await ligarComputador(codigoDaEmpresa, 'PC-2001', '2001', 'Ana Souza');
  return chave;
}

/** Uma empresa nova, com as reuniões liberadas, pelos formulários da administração: o código dela (STAR-…). */
async function novaEmpresa(nome: string): Promise<string> {
  const nova = await formulario('/admin/empresas/nova', '/admin/empresas', { nome });
  // A criação leva à página da empresa: o id vem do Location.
  const id = /^\/admin\/empresas\/(\d+)$/.exec(nova.local)?.[1];
  if (nova.status !== 303 || !id) throw new Error(`criar a empresa respondeu ${nova.status}`);
  const liberar = await formulario('/admin/reunioes', `/admin/reunioes/empresas/${id}`, { liberar: '1' });
  if (liberar.status !== 303) throw new Error(`liberar as reuniões da empresa respondeu ${liberar.status}`);
  const empresa = await (await admin('GET', `/admin/empresas/${id}`)).text();
  const codigo = /STAR-[A-Z0-9]{4}-[A-Z0-9]{4}/.exec(empresa)?.[0];
  if (!codigo) throw new Error('a página da empresa não mostra o código');
  return codigo;
}

/** Um computador da empresa, ligado pela API, com a pessoa da vez: a chave dele e o Computador. */
async function ligarComputador(
  codigoDaEmpresa: string,
  computador: string,
  ramal: string,
  nome: string,
): Promise<{ chave: string; pc: Computador }> {
  const r = await fetch(`${CHAT}/api/v1/computadores`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ codigo: codigoDaEmpresa, computador }),
  });
  if (r.status !== 201) throw new Error(`ligar o computador respondeu ${r.status}`);
  const { chave } = (await r.json()) as { chave: string };
  const pc = new Computador(chave);
  await pc.entrarComo(ramal, nome);
  return { chave, pc };
}

/** O computador do Roberto Alves (3001), de outra empresa (a Beta, com as reuniões liberadas), criada na hora. A chave
 * dele fica anotada. */
export async function computadorDeOutraEmpresa(): Promise<Computador> {
  const codigo = await novaEmpresa('Beta Serviços Ltda');
  const { chave, pc } = await ligarComputador(codigo, 'PC-3001', '3001', 'Roberto Alves');
  anotarSegredos({ chave });
  return pc;
}

// --- A API do chat como um computador ----------------------------------------------------------------------------------

export interface Resposta {
  status: number;
  json: any;
}

/** Um computador do chat, pela chave dele (docs/chat-protocolo.md, seções 5 e 9). */
export class Computador {
  constructor(private readonly chave: string) {}

  async pedir(metodo: string, caminho: string, corpo?: unknown): Promise<Resposta> {
    const r = await fetch(CHAT + caminho, {
      method: metodo,
      headers: {
        authorization: `Bearer ${this.chave}`,
        ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
    const texto = await r.text();
    const json = texto ? JSON.parse(texto) : null;
    anotarSegredos(json);
    return { status: r.status, json };
  }

  /** O pedido que tem de responder o status esperado. A rota é o padrão, como os servidores a registram: o {codigo}
   * dela vira o codigo só no pedido. O erro leva a rota e o erro da resposta, e nunca o código de uma reunião nem o
   * resto do corpo, que vão para o log público do CI e para o relatório. */
  private async certo(metodo: string, rota: string, corpo: unknown, esperado: number, codigo = ''): Promise<any> {
    const r = await this.pedir(metodo, rota.replace('{codigo}', encodeURIComponent(codigo)), corpo);
    if (r.status !== esperado) {
      const erro = typeof r.json?.erro === 'string' ? ` (${r.json.erro})` : '';
      throw new Error(`${metodo} ${rota} respondeu ${r.status}${erro}`);
    }
    return r.json;
  }

  async entrarComo(ramal: string, nome: string): Promise<void> {
    await this.certo('POST', '/api/v1/pessoas/eu', { ramal, nome }, 200);
  }

  /** Uma reunião marcada que começa agora e vale por 2 horas (com o valeAte, ela não acaba à meia-noite). */
  async criarMarcada(): Promise<string> {
    const inicio = Date.now();
    const j = await this.certo('POST', '/api/v1/reunioes', { assunto: 'Planejamento', inicio, valeAte: inicio + 7_200_000 }, 201);
    return j.reuniao.codigo;
  }

  /** O entrar: o Acesso, com a reuniao. */
  entrar(codigo: string): Promise<any> {
    return this.certo('POST', '/api/v1/reunioes/{codigo}/entrar', undefined, 200, codigo);
  }

  participantes(codigo: string): Promise<Resposta> {
    return this.pedir('GET', `/api/v1/reunioes/${encodeURIComponent(codigo)}/participantes`);
  }

  async aceitar(codigo: string, pedido: string): Promise<void> {
    await this.certo('POST', '/api/v1/reunioes/{codigo}/aceitar', { pedido }, 204, codigo);
  }

  async recusar(codigo: string, pedido: string): Promise<void> {
    await this.certo('POST', '/api/v1/reunioes/{codigo}/recusar', { pedido }, 204, codigo);
  }

  async tirar(codigo: string, participante: string): Promise<void> {
    await this.certo('POST', '/api/v1/reunioes/{codigo}/tirar', { participante }, 204, codigo);
  }

  async encerrar(codigo: string): Promise<void> {
    await this.certo('POST', '/api/v1/reunioes/{codigo}/encerrar', undefined, 204, codigo);
  }

  /** O passe do colega para a página da reunião (a resposta o anota como segredo, no pedir). */
  async passe(codigo: string): Promise<string> {
    const j = await this.certo('POST', '/api/v1/reunioes/{codigo}/passe', undefined, 200, codigo);
    if (typeof j?.passe !== 'string') throw new Error('o passe veio sem o passe');
    return j.passe;
  }

  /** A pausa (ou o fim dela) da página do colega aberta neste computador: o status da resposta. */
  async pausa(codigo: string, pausada: boolean, vez: string): Promise<number> {
    return (await this.pedir('POST', `/api/v1/reunioes/${encodeURIComponent(codigo)}/pausa`, { pausada, vez })).status;
  }

  /** O WebSocket dos eventos do app (seção 7), pelo bilhete. O WebSocket do Node não manda a Origin. */
  async eventos(): Promise<EventosDoApp> {
    const { bilhete } = await this.certo('POST', '/api/v1/eventos/bilhete', undefined, 200);
    return EventosDoApp.abrir(`${CHAT.replace(/^http/, 'ws')}/api/v1/eventos?bilhete=${encodeURIComponent(bilhete)}`);
  }
}

/** O computador da Ana Souza, que o ambiente.ts ligou. */
export function ana(): Computador {
  const chave = process.env.STARSONIC_E2E_ANA;
  if (!chave) throw new Error('falta o STARSONIC_E2E_ANA (o ambiente.ts não rodou)');
  return new Computador(chave);
}

/** Os eventos que o WebSocket do app recebe, guardados para os testes esperarem por eles. */
export class EventosDoApp {
  private readonly recebidos: any[] = [];

  private constructor(private readonly ws: WebSocket) {}

  static abrir(url: string): Promise<EventosDoApp> {
    return new Promise((ok, falha) => {
      const ws = new WebSocket(url);
      const e = new EventosDoApp(ws);
      ws.addEventListener('message', (m) => {
        const evento = JSON.parse(String(m.data));
        anotarSegredos(evento);
        e.recebidos.push(evento);
      });
      ws.addEventListener('open', () => ok(e), { once: true });
      ws.addEventListener('error', () => falha(new Error('o WebSocket dos eventos do app não abriu')), { once: true });
    });
  }

  /** Os eventos recebidos até agora que satisfazem a condição. */
  todos(condicao: (e: any) => boolean): any[] {
    return this.recebidos.filter(condicao);
  }

  /** O primeiro evento que satisfaz a condição, esperando até prazo ms. */
  esperar(condicao: (e: any) => boolean, prazo = 20_000): Promise<any> {
    return repetirAte(
      prazo,
      200,
      () => this.recebidos.find(condicao),
      (e) => e !== undefined,
      () => `o app não recebeu o evento esperado em ${prazo / 1000} s; recebeu ${JSON.stringify(this.recebidos.map((x) => x.tipo))}`,
    );
  }

  fechar(): void {
    this.ws.close();
  }
}
