// Como a interface escreve o que vem no estado (só apresentação: as regras ficam no C++). (iPhone) A ordem, a busca e as
// sugestões da agenda do iPhone, as do Android 0.2.0-rc.3 (contacts/ContactsSource.kt): a agenda chega como o iPhone a
// entrega, e a interface a ordena.
import type { AgendaContact, BlfState, CallState, Contact, CurrentAccount, RecentCall, RecentKind, SavedAccount, Shortcut, ShortcutAction } from './state';

/** "Recepção · 2001"; sem nome, só o ramal. */
export function accountTitle(conta: Pick<CurrentAccount | SavedAccount, 'nome' | 'ramal'>): string {
  return conta.nome ? `${conta.nome} · ${conta.ramal}` : conta.ramal;
}

/** A linha do estado no cabeçalho (o `texto` do C++; vazio com sem_conexao). */
export function accountStatusLine(conta: CurrentAccount): string {
  if (conta.texto) return conta.texto;
  switch (conta.status) {
    case 'conectado':
      return `Conectado · ${conta.servidor}`;
    case 'conectando':
      return 'Conectando…';
    default:
      return 'Sem conexão';
  }
}

/** A bolinha da conta em uso (a mesma no cabeçalho, na barra da ligação e nas Configurações). */
export interface AccountDot {
  /** As classes da bolinha: verde conectado, vermelho em ligação e no Não perturbe, ciano conectando, cinza sem
   *  internet, sem conexão e no erro. */
  dot: string;
  /** O texto ao lado (a bolinha nunca diz o estado sozinha). */
  texto: string;
  /** O erro no cadastro: o triângulo de atenção ao lado. */
  atencao: boolean;
}

/**
 * A tabela da rc.3 (spec 7), na ordem: vale a primeira linha que bate.
 * 1. sem internet: cinza, "Sem internet · tentando de novo";
 * 2. conectando: ciano, "Conectando…";
 * 3. erro no cadastro: cinza com o triângulo, o texto do erro (e sem conexão, da rc.2: cinza, sem o triângulo);
 * 4. em ligação (tocando também): vermelha, "Ocupado · em ligação";
 * 5. Não perturbe ligado: vermelha, "Não perturbe · as ligações não tocam";
 * 6. conectado: verde, "Conectado · <servidor>".
 */
export function accountDot(conta: CurrentAccount, emLigacao: boolean, naoPerturbe: boolean): AccountDot {
  if (conta.internet === false) return { dot: 'dot dot-off', texto: 'Sem internet · tentando de novo', atencao: false };
  switch (conta.status) {
    case 'conectando':
      return { dot: 'dot', texto: accountStatusLine(conta), atencao: false };
    case 'erro':
      return { dot: 'dot dot-off', texto: accountStatusLine(conta), atencao: true };
    case 'sem_conexao':
      return { dot: 'dot dot-off', texto: accountStatusLine(conta), atencao: false };
    case 'conectado':
      break;
  }
  if (emLigacao) return { dot: 'dot dot-busy', texto: 'Ocupado · em ligação', atencao: false };
  if (naoPerturbe) return { dot: 'dot dot-busy', texto: 'Não perturbe · as ligações não tocam', atencao: false };
  return { dot: 'dot dot-online', texto: accountStatusLine(conta), atencao: false };
}

const ACAO_NA_ABA: Record<ShortcutAction, string> = {
  ligar: 'Ligar',
  transferir: 'Transferir',
  consulta: 'Consulta',
  teclas: 'Enviar teclas',
};

/** A linha do atalho na aba (o canvas): "Transferir · 2010". */
export function shortcutLine(atalho: Pick<Shortcut, 'acao' | 'numero'>): string {
  return `${ACAO_NA_ABA[atalho.acao]} · ${atalho.numero}`;
}

/** A linha do atalho no painel da ligação: o que ele faz durante a ligação (spec 3.2). */
export function shortcutCallLine(atalho: Pick<Shortcut, 'acao' | 'numero'>): string {
  switch (atalho.acao) {
    case 'ligar':
      return `Nova ligação para ${atalho.numero}`;
    case 'transferir':
      return `Transferir para ${atalho.numero}`;
    case 'consulta':
      return `Consulta com ${atalho.numero}`;
    case 'teclas':
      return `Enviar as teclas ${atalho.numero}`;
  }
}

const PALAVRA_DO_BLF: Record<BlfState, string> = {
  livre: 'Livre',
  tocando: 'Tocando',
  ocupado: 'Ocupado',
  desconectado: 'Desconectado',
};

/** A palavra do BLF (sempre ao lado da bolinha). */
export function blfWord(estado: BlfState): string {
  return PALAVRA_DO_BLF[estado];
}

/**
 * O atalho pode ser usado agora? Fora da ligação, todos menos Enviar teclas; com só uma recebida tocando (sem
 * atender), nenhum (o C++ recusaria todos); com uma segunda ligação (em espera ou tocando), Ligar e Transferir com
 * consulta não (seriam a terceira: o controlador não liga, como a Nova ligação e o Consultar da tela da ligação); nos
 * outros casos, todos (o resto é do C++).
 */
export function shortcutUsable(acao: ShortcutAction, ligacao: CallState | null): boolean {
  if (!ligacao) return acao !== 'teclas';
  if (ligacao.top.phase === 'ringing') return false;
  if (ligacao.second !== null && (acao === 'ligar' || acao === 'consulta')) return false;
  return true;
}

/**
 * Tira das pontas só o espaço, o tab e as quebras de linha, como o TrimAscii da loja de atalhos do C++ (um espaço não
 * separável, por exemplo, fica no nome gravado).
 */
export function trimAscii(texto: string): string {
  return texto.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
}

/** Parece um ramal (só dígitos, de 2 a 6): a chave do BLF vem ligada (com o BLF do administrador). */
export function looksLikeExtension(numero: string): boolean {
  return /^\d{2,6}$/.test(numero);
}

/** O texto cortado em `max` caracteres (pontos de código, como a loja do C++ conta: um emoji conta um). */
export function limitCharacters(texto: string, max: number): string {
  const pontos = [...texto];
  return pontos.length > max ? pontos.slice(0, max).join('') : texto;
}

/** O começo do texto do estado, sem o " · <servidor>" (a faixa do layout Mínimo). */
export function statusWord(texto: string): string {
  return texto.split(' · ')[0];
}

/** A ligação feita mais nova (o Rediscar); null se não tem nenhuma. */
export function lastOutgoing(recentes: RecentCall[]): RecentCall | null {
  return recentes.find((r) => r.tipo === 'feita') ?? null;
}

/** Minúsculas, sem acento: para a busca e os grupos. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function digitsOnly(text: string): string {
  return text.replace(/\D/g, '');
}

/** As iniciais do avatar: a primeira e a última palavra ("Ana Souza" → "AS"; "Financeiro" → "FI"). */
export function initials(nome: string): string {
  const palavras = nome.trim().split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return '?';
  if (palavras.length === 1) return palavras[0].slice(0, 2).toLocaleUpperCase('pt-BR');
  return (palavras[0][0] + palavras[palavras.length - 1][0]).toLocaleUpperCase('pt-BR');
}

/** A letra do grupo dos contatos ("Ágata" → "A"; número ou símbolo → "#"). */
export function groupLetter(nome: string): string {
  const letra = fold(nome.trim()).charAt(0).toUpperCase();
  return /[A-Z]/.test(letra) ? letra : '#';
}

/** "Ramal 2003" para um número curto (um ramal), senão o número como foi gravado. */
export function contactNumberLine(numero: string): string {
  return /^\d{2,6}$/.test(numero.trim()) ? `Ramal ${numero.trim()}` : numero;
}

/** (iPhone) A ordem alfabética do português: os acentos só desempatam, e a caixa não conta (a do Android). */
const ORDEM_DO_PORTUGUES = new Intl.Collator('pt-BR', { sensitivity: 'accent' });

/** (iPhone) O nome de um contato da agenda na tela: o nome, ou (num contato sem nome) o primeiro número. */
export function agendaName(contato: AgendaContact): string {
  return contato.nome.trim() || (contato.numeros[0] ?? '');
}

/** (iPhone) Um contato da agenda pronto para a lista: a letra do grupo, o nome da tela (a ordem) e a busca já calculados. */
interface NaAgenda {
  contato: AgendaContact;
  letra: string;
  nome: string;
  /**
   * O nome da agenda sem acento e sem caixa ("" num contato sem nome: o número que a tela mostra no lugar dele não entra),
   * e os dígitos de cada número.
   */
  nomeBusca: string;
  digitos: string[];
}

/**
 * (iPhone) A agenda pronta de cada lista (uma lista que chega na mensagem `agenda` não muda depois; a próxima vem em outra):
 * a busca a cada tecla, a aba que abre de novo e as sugestões não ordenam outra vez os milhares de contatos.
 */
const AGENDAS_PRONTAS = new WeakMap<AgendaContact[], NaAgenda[]>();

/**
 * (iPhone) Só os contatos com algum número, cada número uma vez (os mesmos dígitos são o mesmo número; vale o primeiro, na
 * ordem da agenda), sem os espaços das pontas; em ordem: o grupo "#" primeiro, depois as letras e, no grupo, a ordem do
 * português (no empate, a da agenda).
 */
function agendaPronta(contatos: AgendaContact[]): NaAgenda[] {
  const pronta = AGENDAS_PRONTAS.get(contatos);
  if (pronta) return pronta;
  const lista: NaAgenda[] = [];
  for (const c of contatos) {
    const vistos = new Set<string>();
    const numeros: string[] = [];
    const digitos: string[] = [];
    for (const gravado of c.numeros) {
      const numero = gravado.trim();
      if (!numero) continue;
      const so = digitsOnly(numero);
      // Um número sem dígitos (raro) só é repetido se for o mesmo texto.
      const chave = so || numero;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      numeros.push(numero);
      digitos.push(so);
    }
    if (numeros.length === 0) continue;
    const contato: AgendaContact = { nome: c.nome.trim(), numeros };
    const nome = agendaName(contato);
    lista.push({ contato, letra: groupLetter(nome), nome, nomeBusca: fold(contato.nome), digitos });
  }
  lista.sort((a, b) => {
    if (a.letra !== b.letra) return a.letra === '#' ? -1 : b.letra === '#' ? 1 : a.letra < b.letra ? -1 : 1;
    return ORDEM_DO_PORTUGUES.compare(a.nome, b.nome);
  });
  AGENDAS_PRONTAS.set(contatos, lista);
  return lista;
}

/**
 * (iPhone) A lista e a busca da aba Contatos: dos contatos da agenda, os que têm algum número, com cada número uma vez e
 * em ordem (ver `agendaPronta`). O texto vale sem os espaços das pontas, como no Android: para qualquer texto, o nome da
 * agenda sem acento e sem caixa ("101" acha o "Apto 101"); sem letras, também os dígitos dentro de algum número; vazio,
 * todos.
 */
export function searchAgenda(contatos: AgendaContact[], texto: string): AgendaContact[] {
  const lista = agendaPronta(contatos);
  const procurado = texto.trim();
  if (!procurado) return lista.map((c) => c.contato);
  const nome = fold(procurado);
  // Um texto sem letras e sem dígitos (o "-", o "(") vale só pelo nome.
  const digitos = /\p{L}/u.test(procurado) ? '' : digitsOnly(procurado);
  return lista.filter((c) => c.nomeBusca.includes(nome) || (digitos !== '' && c.digitos.some((d) => d.includes(digitos)))).map((c) => c.contato);
}

/**
 * (iPhone) As sugestões do Teclado e do número do Transferir e da Nova ligação: um `Contact` por número da agenda, na
 * ordem da aba Contatos, com o id `agenda-<contato>-<número>` e sem observação. O nome é o da agenda ("" num contato sem
 * nome: a sugestão mostra o número).
 */
export function agendaSuggestions(contatos: AgendaContact[]): Contact[] {
  return searchAgenda(contatos, '').flatMap((c, i) => c.numeros.map((numero, j) => ({ id: `agenda-${i}-${j}`, nome: c.nome, numero, observacao: '' })));
}

const TIPO: Record<RecentKind, string> = { feita: 'Feita', recebida: 'Recebida', perdida: 'Perdida' };

export function recentKindLabel(tipo: RecentKind): string {
  return TIPO[tipo];
}

/** "14:32". */
export function clockTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "4 min 18 s", "1 min 02 s", "35 s", "1 h 05 min". A duração vem em milissegundos. */
export function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const min = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${String(min).padStart(2, '0')} min`;
  if (min > 0) return `${min} min ${String(s).padStart(2, '0')} s`;
  return `${s} s`;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** O grupo do dia: "Hoje", "Ontem" ou a data ("19 de outubro"; com o ano, se for de outro ano). */
export function dayGroup(ms: number, now: number = Date.now()): string {
  const hoje = startOfDay(now);
  const dia = startOfDay(ms);
  const dias = Math.round((hoje - dia) / 86_400_000);
  if (dias === 0) return 'Hoje';
  if (dias === 1) return 'Ontem';
  const d = new Date(ms);
  const opcoes: Intl.DateTimeFormatOptions =
    d.getFullYear() === new Date(now).getFullYear() ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' };
  return new Intl.DateTimeFormat('pt-BR', opcoes).format(d);
}

/**
 * A hora de uma leitura da planilha da empresa (spec da rc.4, 7.1), na hora local: "às 14:32" se for de hoje, senão
 * "em 26/10 às 14:32".
 */
export function readTime(ms: number, now: number = Date.now()): string {
  const hora = `às ${clockTime(ms)}`;
  if (startOfDay(ms) === startOfDay(now)) return hora;
  const d = new Date(ms);
  return `em ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${hora}`;
}

/** "230 contatos"; um só no singular (Ruling R7): "1 contato". */
export function contactCount(n: number): string {
  return n === 1 ? '1 contato' : `${n} contatos`;
}

/** "Depois de 3 segundos tocando". */
export function autoAnswerLine(segundos: number): string {
  if (segundos <= 0) return 'Assim que tocar';
  return segundos === 1 ? 'Depois de 1 segundo tocando' : `Depois de ${segundos} segundos tocando`;
}

/** O tempo da ligação: "03:12"; com uma hora ou mais, "1:03:12". */
export function callTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** O nome (já resolvido pelo C++) ou, sem ele, o número. */
export function nameOrNumber(card: { name: string; number: string }): string {
  return card.name || card.number;
}

/** A primeira palavra do nome (ou o número): "Você, Ana e Carlos". */
export function firstName(card: { name: string; number: string }): string {
  return card.name.trim().split(/\s+/)[0] || card.number;
}
