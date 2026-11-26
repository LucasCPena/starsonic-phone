// O cliente das reuniões: a lista das que a pessoa marcou e o que a aba precisa saber (se aparece, se há conexão). Ele
// mora ao lado do ChatCliente e usa a sessão dele (pedir e assinarSessao): a pessoa da vez, os eventos e as paradas.
// - A leitura da lista (GET /reunioes) acontece a cada conexão dos eventos, quando a aba entra na vista e a cada 30 s
//   com ela à vista. Deu certo: a lista e a aba. O 403 `semReunioes` (a empresa não tem as reuniões): a aba some, e a
//   pergunta se repete a cada 5 minutos e a cada conexão dos eventos. Qualquer outra falha é a falta de conexão, e a
//   próxima leitura tenta de novo (com a aba escondida, também em 30 s). O Parado (a pessoa trocou) não conta.
// - A aba começa escondida (`aba` falso) e só aparece com a primeira leitura que dá certo: uma empresa sem as reuniões
//   nunca a vê, nem por um instante.
// - A parada da sessão (a pessoa trocou, o chat desligou) esquece a lista e para os relógios; a aba fica como estava
//   (as reuniões são da empresa, e o computador continua nela). A lista da pessoa seguinte vem da primeira leitura
//   dela.
// - O `criar` (a Nova reunião) cria como a pessoa da vez, lê a lista de novo e copia o link; o `copiar` escreve o link
//   no clipboard e faz a vista dizer o `copiado` (a linha da reunião diz "Link copiado") por 2 s; o `cancelar` cancela
//   a reunião e relê a lista (o 404, ela já não existe, também resolve).
// - O `pedirPasse` pede o passe como a pessoa da vez, guarda a reunião da resposta e diz os erros do passe. O
//   `abrirNoNavegador` o usa (um pedido por código de cada vez) e manda o reuniaoNavegador com o código e o passe: o
//   passe vai da resposta para o comando e para mais lugar nenhum (nem uma variável da classe, nem o estado, nem o
//   console). O `abrirComoConvidado` manda o comando sem o passe. O `avisar` é o aviso curto do app (a tela o mostra
//   como o toast).
// - (Task 11) As reuniões abertas no navegador: o cliente guarda, só na memória, cada uma (o assunto e o valeAte, se
//   conhecidos; se o computador está nela) e os pedidos para entrar, na ordem em que chegaram. Os eventos das reuniões
//   dizem se o computador está nela; o servidor não avisa que ele saiu, e por isso a conferência (o GET participantes)
//   de cada reunião em que ele está sai a cada 10 s e na hora a cada conexão dos eventos. O aviso do Windows mostra o
//   pedido mais antigo que ainda não saiu dele (o reuniaoPedido, uma vez só para cada mudança); a resposta dele
//   (reuniaoResposta) tira o pedido do aviso na hora e chama a rota. O que sai do aviso por uma resposta fica no
//   cliente enquanto a reunião o lista (um evento ou a conferência que ainda o traz não o põe de volta no aviso); só a
//   rota que falha o devolve. A parada da sessão esquece tudo.
// - (Task 12) A pausa: enquanto uma ligação pausa (pausa.ts; desde o plano 3b, com a regra da reunião dentro do app: a
//   ligação em espera pelo "Voltar para a reunião" não pausa), cada reunião aberta no navegador cujo link ainda vale
//   recebe o `pausada` verdadeiro, com o `vez` da pausa, na hora e a cada 10 s; o falso, uma vez, no fim, a cada uma
//   que a pausa alcançou. Um evento que mostra o computador entrando numa reunião manda a pausa dela na hora. O
//   `ouvindoNoNavegador` da vista diz quando a reunião do navegador pode continuar ouvindo a pessoa: a última tentativa
//   de pausar uma reunião em que o computador está falhou, ou a dúvida (o servidor avisou que ia desligar e, na volta,
//   não conhece mais o computador na reunião: a pessoa pode ter saído, ou a página continua nela sem a pausa).
// Nada de uma reunião vai ao console.
import type { Bridge } from '../bridge';
import { ehChave, ErroChat } from '../chat/api';
import { ehParado, type ChatCliente } from '../chat/cliente';
import { limitCharacters } from '../format';
import { haPausa, novaVez } from './pausa';
import type { CallState, Command, RespostaDoAviso } from '../state';
import {
  LINK_SEM_VALOR,
  MUITAS_TENTATIVAS,
  REUNIAO_CHEIA,
  REUNIAO_DE_OUTRA_EMPRESA,
  SERVIDOR_NAO_RESPONDEU,
  SERVIDOR_PRECISA_ATUALIZAR,
} from './textos';
import type { EventoDaReuniao, Pedido, Reuniao } from './tipos';

export interface VistaReunioes {
  /** A aba aparece: false até a primeira leitura dar certo, e de novo depois de um 403 semReunioes. */
  aba: boolean;
  /** A primeira leitura da lista desta pessoa já terminou (deu certo, o semReunioes ou falhou). */
  respondeu: boolean;
  /** As reuniões da pessoa da vez; null antes da primeira leitura. */
  lista: Reuniao[] | null;
  /** false: a frase da falta de conexão no lugar da lista. */
  conectado: boolean;
  /** O código da reunião cuja linha diz "Link copiado" (por 2 s); null sem nenhuma. */
  copiado: string | null;
  /** Um aviso curto para a tela (o toast do app); a `vez` sobe a cada aviso. */
  avisoCurto: { texto: string; vez: number } | null;
  /** A frase na tela da ligação: a reunião do navegador continua ouvindo a pessoa. */
  ouvindoNoNavegador: boolean;
}

/** O pedido do passe que falhou. `erro` null: nada a dizer (a pessoa trocou no meio, ou a aba sumiu). */
export type ResultadoSemPasse = { ok: false; erro: string | null; outraEmpresa: boolean };
export type ResultadoDoNavegador = { ok: true } | ResultadoSemPasse;

/** A lista é lida de novo a esta distância, com a aba à vista (e depois de uma falha). */
export const RELEITURA_MS = 30_000;
/** A pergunta que a aba escondida pelo semReunioes repete. */
export const PERGUNTA_DE_NOVO_MS = 300_000;
/** O "Link copiado" da linha dura isto. */
export const LINK_COPIADO_MS = 2_000;

/** A conferência dos pedidos das reuniões em que o computador está. */
export const CONFERENCIA_MS = 10_000;
/** A pausa é mandada de novo a esta distância, enquanto a ligação dura. */
export const PAUSA_MS = 10_000;
/** A dúvida depois de um reinício do chat acaba tanto tempo depois de começar. */
export const DUVIDA_MS = 12 * 3_600_000;
/** O mais que o aviso aceita (pontos de código) no nome e no assunto. */
const MAXIMO_DO_AVISO = 120;
const ID_DO_PEDIDO = /^[0-9a-f]{16}$/;
const CONTROLE = /[\u0000-\u001f\u007f-\u009f]/g;
const SURROGADO_SOLTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** O texto como o núcleo o aceita no aviso: sem controle, sem surrogado solto, com até 120 pontos de código. */
const paraOAviso = (t: string): string =>
  limitCharacters(t.replace(CONTROLE, '').replace(SURROGADO_SOLTO, '\uFFFD'), MAXIMO_DO_AVISO);

type ComandoDoPedido = Extract<Command, { cmd: 'reuniaoPedido' }>;

/** Uma reunião aberta no navegador. */
interface Aberta {
  /** O assunto ("" sem assunto) e o valeAte (null sem validade); null: o app não os conhece. */
  info: { assunto: string; valeAte: number | null } | null;
  /** O computador está nela, pelo que o app sabe. */
  dentro: boolean;
  /** A pessoa (o id no chat) com quem o app a conheceu. */
  pessoa: number | null;
  /** Sobe a cada evento dela: a resposta de um pedido que saiu antes dele não vale mais. */
  epoca: number;
  /** A última tentativa de pausá-la que terminou falhou (sem resposta, um 5xx, o 429 ou outro erro). */
  falhou: boolean;
  /** O servidor avisou que ia desligar depois da última vez em que o app viu o computador nela. */
  desligou: boolean;
  /** Quando começou a dúvida (o chat voltou sem conhecer o computador nela); null: sem dúvida. */
  duvida: number | null;
}

/** Uma pausa em andamento: o `vez` dela e as reuniões a que ela foi mandada. */
interface Pausa {
  vez: string;
  enviadas: Set<string>;
}

/** Um pedido para entrar; `fora`: já saiu do aviso (a resposta, ou o fechar). */
interface PedidoGuardado {
  id: string;
  reuniao: string;
  nome: string;
  fora: boolean;
}

/** Os campos da pausa de uma reunião que acaba de ser conhecida. */
const SEM_PAUSA = { falhou: false, desligou: false, duvida: null };

const ehSemReunioes = (e: unknown): boolean => e instanceof ErroChat && e.status === 403 && e.erro === 'semReunioes';

export class ReunioesCliente {
  private readonly chat: ChatCliente;
  private readonly bridge: Bridge;
  private readonly ouvintes = new Set<() => void>();
  private aba = false;
  /** A primeira leitura desta pessoa terminou (a sessão que para a esquece). */
  private respondeu = false;
  private lista: Reuniao[] | null = null;
  /** A última leitura falhou (sem rede, um 5xx...): a frase da falta de conexão. */
  private falhou = false;
  /** O servidor disse que a empresa não tem as reuniões (o 403 semReunioes): a pergunta se repete a cada 5 minutos. */
  private semReunioes = false;
  private aVista = false;
  /** Sobe a cada parada da sessão: a resposta de antes dela não vale. */
  private vez = 0;
  /** Sobe a cada leitura: só a última a sair vale. */
  private leitura = 0;
  private relogio: ReturnType<typeof setTimeout> | undefined;
  /** A reunião cuja linha diz "Link copiado", e o relógio que a apaga. */
  private copiado: string | null = null;
  private relogioDoCopiado: ReturnType<typeof setTimeout> | undefined;
  /** Os códigos com um pedido de passe no ar: um pedido por código de cada vez. */
  private readonly abrindo = new Set<string>();
  /** As reuniões abertas no navegador, pelo código que o servidor dá. */
  private readonly abertas = new Map<string, Aberta>();
  /**
   * As reuniões que o app conhecia numa sessão que parou, com a pessoa dela (só na memória, enquanto o app vive): o
   * servidor manda os eventos de uma reunião ao computador, seja quem for que o use agora. O de uma reunião lembrada
   * com outra pessoa não vale (a spec, 4.5: a troca de conta esquece as reuniões do navegador).
   */
  private readonly lembradas = new Map<string, number | null>();
  /** Os pedidos para entrar, na ordem em que chegaram, de todas as reuniões. */
  private pedidos: PedidoGuardado[] = [];
  /** O último reuniaoPedido mandado ao núcleo (o JSON dele): o núcleo começa sem pedido. */
  private ultimoPedido = JSON.stringify({ cmd: 'reuniaoPedido' });
  /** O relógio da conferência (um só, para todas as reuniões). */
  private conferencia: ReturnType<typeof setTimeout> | undefined;
  /** As reuniões com uma conferência no ar. */
  private conferindo = new Set<string>();
  /** O último aviso curto. */
  private avisoCurto: { texto: string; vez: number } | null = null;
  /** O último `haPausa` visto: a pausa começa e acaba nas mudanças dele. */
  private haPausaAgora = false;
  /** A pausa de agora (null sem ela) e o relógio que a repete. */
  private pausa: Pausa | null = null;
  private relogioDaPausa: ReturnType<typeof setTimeout> | undefined;
  /**
   * O último pedido da pausa de cada reunião, até terminar: o seguinte espera por ele. O servidor repassa à página na
   * ordem em que os pedidos entram nele, e não na ordem em que o app os mandou: um falso que passasse na frente de um
   * verdadeiro ainda no ar deixaria a página em pausa depois da ligação.
   */
  private readonly filaDaPausa = new Map<string, Promise<void>>();
  /** A reunião da vista dentro do app (o código e se ela está escondida), ou null. */
  private noApp: { codigo: string; escondida: boolean } | null = null;
  private v: VistaReunioes;

  constructor(o: { chat: ChatCliente; bridge: Bridge; base: string }) {
    this.chat = o.chat;
    this.bridge = o.bridge;
    this.v = this.montar();
    // O `conectado` depende do chat estar pronto e conectado.
    o.chat.assinar(() => this.publicar());
    o.chat.assinarSessao({
      evento: (e) => this.evento(e),
      conectou: () => {
        void this.ler();
        // Cada volta dos eventos (a primeira não tem reunião nenhuma): o que houve enquanto caiu.
        this.conferirTodas();
      },
      desligando: () => this.desligando(),
      parou: () => this.parou(),
    });
  }

  vista(): VistaReunioes {
    return this.v;
  }

  assinar(f: () => void): () => void {
    this.ouvintes.add(f);
    return () => {
      this.ouvintes.delete(f);
    };
  }

  /** A aba Reuniões entrou na vista (lê a lista na hora, e de novo a cada 30 s) ou saiu dela. */
  abaAVista(aVista: boolean): void {
    if (this.aVista === aVista) return;
    this.aVista = aVista;
    if (aVista) void this.ler();
    else this.armar();
  }

  /**
   * Cria a reunião como a pessoa da vez, relê a lista e copia o link. Rejeita com o ErroChat (a tela diz a falha); o
   * 403 `semReunioes` também esconde a aba (a leitura que o cliente faz na hora).
   */
  async criar(corpo: { assunto?: string; inicio: number; valeAte: number }): Promise<Reuniao> {
    let reuniao: Reuniao;
    try {
      reuniao = await this.chat.pedir((api) => api.criarReuniao(corpo));
    } catch (e) {
      if (ehSemReunioes(e)) void this.ler();
      throw e;
    }
    // A lista com a reunião nova, e só então o link copiado: a linha já existe quando ela diz "Link copiado".
    await this.ler();
    await this.copiar(reuniao);
    return reuniao;
  }

  /**
   * Copia o link da reunião (o `link` que o servidor deu) pelo navigator.clipboard.writeText. true: copiado, e a vista
   * diz o `copiado` por 2 s. false: a cópia falhou (sem a permissão, sem o foco), e nada muda.
   */
  async copiar(reuniao: Pick<Reuniao, 'codigo' | 'link'>): Promise<boolean> {
    const vez = this.vez;
    try {
      await navigator.clipboard.writeText(reuniao.link);
    } catch {
      return false;
    }
    if (vez !== this.vez) return false;
    clearTimeout(this.relogioDoCopiado);
    this.copiado = reuniao.codigo;
    this.relogioDoCopiado = setTimeout(() => {
      this.copiado = null;
      this.relogioDoCopiado = undefined;
      this.publicar();
    }, LINK_COPIADO_MS);
    this.publicar();
    return true;
  }

  /**
   * Cancela a reunião como a pessoa da vez e relê a lista. O 404 (ela já não existe) também resolve, com a lista
   * relida. Rejeita com o ErroChat nas outras falhas (o diálogo diz a falha).
   */
  async cancelar(codigo: string): Promise<void> {
    try {
      await this.chat.pedir((api) => api.cancelarReuniao(codigo));
    } catch (e) {
      if (!(e instanceof ErroChat && e.status === 404)) throw e;
    }
    await this.ler();
  }

  /**
   * Pede o passe como a pessoa da vez e guarda a reunião da resposta entre as abertas. Os erros são os do
   * abrirNoNavegador (a tabela do erroDoPasse). O passe vai da resposta para quem pediu e para mais lugar nenhum.
   */
  async pedirPasse(codigo: string): Promise<{ ok: true; passe: string; reuniao: Reuniao } | ResultadoSemPasse> {
    const vez = this.vez;
    try {
      const r = await this.chat.pedir((api) => api.passeDaReuniao(codigo));
      this.guardar(r.reuniao);
      return { ok: true, passe: r.passe, reuniao: r.reuniao };
    } catch (e) {
      return await this.erroDoPasse(e, codigo, vez);
    }
  }

  /**
   * Pede o passe como a pessoa da vez e manda o reuniaoNavegador com o código e o passe: a resposta vai direto ao
   * comando. Um pedido por código de cada vez (o segundo, com o primeiro no ar, não faz nada: `erro` null).
   */
  async abrirNoNavegador(codigo: string): Promise<ResultadoDoNavegador> {
    if (this.abrindo.has(codigo)) return { ok: false, erro: null, outraEmpresa: false };
    this.abrindo.add(codigo);
    try {
      const r = await this.pedirPasse(codigo);
      if (!r.ok) return r;
      this.bridge.send({ cmd: 'reuniaoNavegador', codigo, passe: r.passe });
      // A reunião agora é a do navegador: o fim da vista do app (o `reuniaoNoApp(null)`) não a tira das abertas.
      if (this.noApp?.codigo === codigo) this.noApp = null;
      return { ok: true };
    } finally {
      this.abrindo.delete(codigo);
    }
  }

  /** A reunião de outra empresa: o reuniaoNavegador sem o passe (a pessoa entra como convidada). */
  abrirComoConvidado(codigo: string): void {
    this.bridge.send({ cmd: 'reuniaoNavegador', codigo });
  }

  /** Um aviso curto para a tela (o toast do app). */
  avisar(texto: string): void {
    this.avisoCurto = { texto, vez: (this.avisoCurto?.vez ?? 0) + 1 };
    this.publicar();
  }

  /** O que cada falha do pedido do passe vira (a tabela da Task 10). */
  private async erroDoPasse(e: unknown, codigo: string, vez: number): Promise<ResultadoSemPasse> {
    const dizer = (erro: string | null, outraEmpresa = false): ResultadoSemPasse => ({
      ok: false,
      erro,
      outraEmpresa,
    });
    if (ehParado(e)) return dizer(null);
    if (!(e instanceof ErroChat)) return dizer(SERVIDOR_NAO_RESPONDEU);
    if (e.status === 404) {
      // Uma reunião da lista da pessoa que o servidor não conhece: se a lista relida ainda a tem, o servidor é antigo.
      if (!this.lista?.some((r) => r.codigo === codigo)) return dizer(LINK_SEM_VALOR);
      await this.ler();
      if (vez !== this.vez) return dizer(null);
      if (this.falhou) return dizer(SERVIDOR_NAO_RESPONDEU);
      return dizer(this.lista?.some((r) => r.codigo === codigo) ? SERVIDOR_PRECISA_ATUALIZAR : LINK_SEM_VALOR);
    }
    if (e.status === 403 && e.erro === 'outraEmpresa') return dizer(REUNIAO_DE_OUTRA_EMPRESA, true);
    if (ehSemReunioes(e)) {
      await this.ler();
      return dizer(null);
    }
    if (e.status === 429) return dizer(MUITAS_TENTATIVAS);
    return dizer(SERVIDOR_NAO_RESPONDEU);
  }

  private montar(): VistaReunioes {
    const c = this.chat.vista();
    return {
      aba: this.aba,
      respondeu: this.respondeu,
      lista: this.lista,
      conectado: c.situacao === 'pronto' && c.conectado && !this.falhou,
      copiado: this.copiado,
      avisoCurto: this.avisoCurto,
      ouvindoNoNavegador: this.ouvindo(),
    };
  }

  /** Diz às telas, se a vista mudou. Uma leitura que deu certo traz sempre uma lista nova (a hora é lida de novo). */
  private publicar(): void {
    const nova = this.montar();
    const igual =
      nova.aba === this.v.aba &&
      nova.respondeu === this.v.respondeu &&
      nova.lista === this.v.lista &&
      nova.conectado === this.v.conectado &&
      nova.copiado === this.v.copiado &&
      nova.avisoCurto === this.v.avisoCurto &&
      nova.ouvindoNoNavegador === this.v.ouvindoNoNavegador;
    if (igual) return;
    this.v = nova;
    for (const f of [...this.ouvintes]) f();
  }

  private async ler(): Promise<void> {
    const vez = this.vez;
    const n = ++this.leitura;
    clearTimeout(this.relogio);
    let lista: Reuniao[] | null = null;
    let erro: unknown = null;
    try {
      lista = await this.chat.pedir((api) => api.reunioes(), { lendo: true });
    } catch (e) {
      erro = e;
    }
    // A pessoa trocou, ou outra leitura saiu depois desta: a resposta não vale.
    if (vez !== this.vez || n !== this.leitura || ehParado(erro)) return;
    this.respondeu = true;
    if (lista) {
      this.aba = true;
      this.lista = lista;
      this.falhou = false;
      this.semReunioes = false;
    } else if (ehSemReunioes(erro)) {
      this.aba = false;
      this.lista = null;
      this.falhou = false;
      this.semReunioes = true;
    } else {
      this.falhou = true;
    }
    this.armar();
    this.publicar();
  }

  /** A próxima leitura: 30 s com a aba à vista (ou depois de uma falha); 5 minutos se o servidor a escondeu. */
  private armar(): void {
    clearTimeout(this.relogio);
    this.relogio = undefined;
    const ms = this.semReunioes ? PERGUNTA_DE_NOVO_MS : this.aVista || this.falhou ? RELEITURA_MS : null;
    if (ms !== null) this.relogio = setTimeout(() => void this.ler(), ms);
  }

  /** A sessão parou: a lista é esquecida e os relógios param. A aba fica como estava. */
  private parou(): void {
    this.vez += 1;
    this.leitura += 1;
    clearTimeout(this.relogio);
    this.relogio = undefined;
    clearTimeout(this.relogioDoCopiado);
    this.relogioDoCopiado = undefined;
    this.copiado = null;
    this.lista = null;
    this.respondeu = false;
    this.falhou = false;
    this.semReunioes = false;
    // As reuniões continuam no navegador, com a pessoa que entrou: o app só as esquece.
    for (const [codigo, a] of this.abertas) this.lembradas.set(codigo, a.pessoa);
    this.abertas.clear();
    this.pedidos = [];
    this.conferindo = new Set();
    // Nada mais é mandado da pausa de antes: a de agora recomeça com a primeira reunião que um evento trouxer.
    this.pausa?.enviadas.clear();
    this.filaDaPausa.clear();
    clearTimeout(this.relogioDaPausa);
    this.relogioDaPausa = undefined;
    this.mudou();
    this.publicar();
  }

  /** A reunião cujo passe deu certo entra entre as abertas no navegador (com o assunto e o valeAte da resposta). */
  private guardar(r: Reuniao): void {
    const info = { assunto: r.assunto ?? '', valeAte: r.valeAte };
    const antes = this.abertas.get(r.codigo);
    this.lembradas.delete(r.codigo);
    if (antes) antes.info = info;
    else this.abertas.set(r.codigo, { info, dentro: false, pessoa: this.pessoa(), epoca: 0, ...SEM_PAUSA });
  }

  /** O que um evento diz da reunião: ela entra na lista se o app não a conhecia (com o que a lista da pessoa sabe). */
  private daReuniao(codigo: string): Aberta | null {
    let a = this.abertas.get(codigo);
    if (!a) {
      if (this.lembradas.has(codigo) && this.lembradas.get(codigo) !== this.pessoa()) return null;
      this.lembradas.delete(codigo);
      const da = this.lista?.find((r) => r.codigo === codigo);
      a = {
        info: da ? { assunto: da.assunto ?? '', valeAte: da.valeAte } : null,
        dentro: false,
        pessoa: this.pessoa(),
        epoca: 0,
        ...SEM_PAUSA,
      };
      this.abertas.set(codigo, a);
    }
    a.epoca += 1;
    // Um evento da reunião acaba com a dúvida: o servidor a conhece, com o computador nela.
    a.desligou = false;
    a.duvida = null;
    const entrou = !a.dentro;
    a.dentro = true;
    // O computador entrou durante uma pausa: a pausa dela sai na hora, sem esperar a rodada.
    if (entrou && this.pausa) {
      this.armarAPausa();
      void this.pausarUma(codigo, this.pausa);
    }
    return a;
  }

  /** A pessoa da sessão de agora. */
  private pessoa(): number | null {
    return this.chat.vista().eu?.id ?? null;
  }

  private evento(e: EventoDaReuniao): void {
    switch (e.tipo) {
      case 'reuniaoParticipantes':
        if (!this.daReuniao(e.reuniao)) return;
        this.definirPedidos(e.reuniao, e.pedidos);
        break;
      case 'reuniaoPedido':
        if (!this.daReuniao(e.reuniao)) return;
        this.juntar(e.reuniao, e.pedido);
        break;
      case 'reuniaoPedidoFim':
        if (!this.daReuniao(e.reuniao)) return;
        this.pedidos = this.pedidos.filter((p) => p.id !== e.pedido);
        break;
      case 'reuniaoAcabou': {
        const a = this.abertas.get(e.reuniao);
        if (!a) return;
        a.epoca += 1;
        a.desligou = false;
        a.duvida = null;
        this.sair(e.reuniao, a);
        break;
      }
      default:
        return;
    }
    this.mudou();
  }

  /** O pedido novo entra no fim (um que já é conhecido fica onde está, e com o `fora` que tem). */
  private juntar(reuniao: string, p: Pedido): void {
    if (!ID_DO_PEDIDO.test(p.id) || this.pedidos.some((x) => x.id === p.id)) return;
    // O nome que fica vazio depois da limpeza não vai ao aviso (o núcleo o recusaria): fica no painel da reunião.
    const nome = paraOAviso(p.nome);
    if (nome) this.pedidos.push({ id: p.id, reuniao, nome, fora: false });
  }

  /** Os pedidos da reunião são estes: os que já eram conhecidos ficam, os que acabaram saem. */
  private definirPedidos(reuniao: string, lista: Pedido[]): void {
    const ids = new Set(lista.map((p) => p.id));
    this.pedidos = this.pedidos.filter((p) => p.reuniao !== reuniao || ids.has(p.id));
    for (const p of lista) this.juntar(reuniao, p);
  }

  /** O computador não está mais na reunião, e os pedidos dela saem. */
  private sair(codigo: string, a: Aberta): void {
    a.dentro = false;
    this.pedidos = this.pedidos.filter((p) => p.reuniao !== codigo);
  }

  /** A regra do "fora" (o 409 foraDaReuniao de qualquer rota): vale numa reunião em que o computador estava. */
  private foraDaReuniao(codigo: string, epoca: number): void {
    const a = this.abertas.get(codigo);
    if (!a || !a.dentro || a.epoca !== epoca) return;
    // O servidor avisou que ia desligar desde a última vez que o app o viu nela: o chat reiniciou e a esqueceu, e a
    // página do navegador pode continuar nela. Sem o aviso, a pessoa saiu, a rede caiu ou o PC dormiu: sem dúvida.
    if (a.desligou) a.duvida = Date.now();
    a.desligou = false;
    this.sair(codigo, a);
    this.mudou();
  }

  /** O servidor vai desligar: vale para cada reunião em que o computador está. */
  private desligando(): void {
    for (const a of this.abertas.values()) if (a.dentro) a.desligou = true;
  }

  /** O link da reunião ainda vale (o valeAte desconhecido conta como valendo). */
  private linkVale(a: Aberta, agora: number): boolean {
    return a.info === null || a.info.valeAte === null || a.info.valeAte > agora;
  }

  /** A dúvida da reunião ainda vive: começou há menos de 12 horas, e o link dela ainda vale. */
  private duvidaViva(a: Aberta, agora: number): boolean {
    return a.duvida !== null && agora - a.duvida < DUVIDA_MS && this.linkVale(a, agora);
  }

  /** A frase da tela da ligação: a pausa dura e alguma reunião de link válido pode continuar ouvindo a pessoa. */
  private ouvindo(): boolean {
    if (!this.pausa) return false;
    const agora = Date.now();
    for (const [codigo, a] of this.abertas) {
      if (this.ehDoApp(codigo)) continue;
      if (this.linkVale(a, agora) && ((a.dentro && a.falhou) || this.duvidaViva(a, agora))) return true;
    }
    return false;
  }

  /**
   * A reunião da vista do app (o código e se ela está escondida), ou null sem ela. Os eventos dela continuam trazendo
   * os pedidos ao aviso, com o `escondida` daqui; ela não entra na pausa do navegador nem no `ouvindoNoNavegador` (a
   * pausa dela é a da vista). Sem ela, a reunião sai das abertas:
   * o pedido do passe a pôs lá como se fosse do navegador.
   */
  reuniaoNoApp(r: { codigo: string; escondida: boolean } | null): void {
    const antes = this.noApp;
    if (antes?.codigo === r?.codigo && antes?.escondida === r?.escondida) return;
    this.noApp = r;
    if (antes !== null && antes.codigo !== r?.codigo) {
      this.abertas.delete(antes.codigo);
      this.pedidos = this.pedidos.filter((p) => p.reuniao !== antes.codigo);
      this.mudou();
    } else {
      this.mostrarNoAviso();
      this.publicar();
    }
  }

  /** A reunião é a da vista do app: fora da pausa e da frase do navegador. */
  private ehDoApp(codigo: string): boolean {
    return this.noApp?.codigo === codigo;
  }

  /**
   * As ligações do estado da ponte, a cada estado: a pausa começa e acaba com o `haPausa`, com o `emEspera` da reunião
   * dentro do app (a ligação que o "Voltar para a reunião" pôs em espera não pausa as do navegador).
   */
  ligacoes(l: CallState | null, emEspera: number | null = null): void {
    const ha = haPausa(l, emEspera);
    if (ha !== this.haPausaAgora) {
      this.haPausaAgora = ha;
      if (ha) this.comecarAPausa();
      else this.acabarAPausa();
    }
    // A hora também conta (a dúvida e o link vencem): a vista é conferida a cada estado.
    this.publicar();
  }

  private comecarAPausa(): void {
    this.pausa = { vez: novaVez(), enviadas: new Set() };
    for (const a of this.abertas.values()) a.falhou = false;
    this.rodada();
  }

  /** A pausa acabou: o falso, uma vez, a cada reunião que ela alcançou e que o cliente ainda tem; sem repetir. */
  private acabarAPausa(): void {
    const pausa = this.pausa;
    this.pausa = null;
    clearTimeout(this.relogioDaPausa);
    this.relogioDaPausa = undefined;
    if (pausa) {
      for (const codigo of pausa.enviadas) this.pausarOFim(codigo, pausa);
    }
    this.publicar();
  }

  /**
   * O pausada falso de uma reunião que a pausa alcançou e que o cliente ainda tem; as falhas não são repetidas. A
   * resposta vale como a da pausa: o 409 foraDaReuniao é a regra do "fora", o 404 tira a reunião, o 204 acaba a dúvida.
   */
  private pausarOFim(codigo: string, pausa: Pausa): void {
    const a = this.abertas.get(codigo);
    if (!a) return;
    const vez = this.vez;
    const epoca = a.epoca;
    this.enviarAPausa(codigo, false, pausa).then(
      () => this.pausaChegou(codigo, vez, false),
      (e) => this.pausaSemResposta(codigo, e, vez, epoca, false),
    );
  }

  /**
   * Manda o `pausada` à reunião depois de o pedido anterior dela terminar (com resposta ou sem). Um verdadeiro que
   * espera e já não tem pausa, ou que é de antes de uma parada da sessão, não sai (resolve sem mandar).
   */
  private enviarAPausa(codigo: string, pausada: boolean, pausa: Pausa): Promise<void> {
    const vez = this.vez;
    const anterior = this.filaDaPausa.get(codigo) ?? Promise.resolve();
    const este = anterior.then(async () => {
      if (vez !== this.vez) throw new Error('parou');
      if (pausada && this.pausa !== pausa) return;
      await this.chat.pedir((api) => api.pausarReuniao(codigo, pausada, pausa.vez));
    });
    const terminou = este.then(
      () => undefined,
      () => undefined,
    );
    this.filaDaPausa.set(codigo, terminou);
    void terminou.then(() => {
      if (this.filaDaPausa.get(codigo) === terminou) this.filaDaPausa.delete(codigo);
    });
    return este;
  }

  /** Uma rodada da pausa: a todas as reuniões, e a próxima daqui a 10 s. */
  private rodada(): void {
    const pausa = this.pausa;
    if (!pausa) return;
    for (const codigo of [...this.abertas.keys()]) if (!this.ehDoApp(codigo)) void this.pausarUma(codigo, pausa);
    this.armarAPausa();
    this.publicar();
  }

  private armarAPausa(): void {
    if (this.relogioDaPausa !== undefined || !this.pausa) return;
    this.relogioDaPausa = setTimeout(() => {
      this.relogioDaPausa = undefined;
      this.rodada();
    }, PAUSA_MS);
  }

  /** Manda o `pausada` verdadeiro a uma reunião cujo link ainda vale, e trata a resposta (a tabela da Task 12). */
  private async pausarUma(codigo: string, pausa: Pausa): Promise<void> {
    const antes = this.abertas.get(codigo);
    if (!antes || this.ehDoApp(codigo) || !this.linkVale(antes, Date.now())) return;
    pausa.enviadas.add(codigo);
    const vez = this.vez;
    const epoca = antes.epoca;
    try {
      await this.enviarAPausa(codigo, true, pausa);
    } catch (e) {
      this.pausaSemResposta(codigo, e, vez, epoca, true);
      return;
    }
    if (this.pausa === pausa) this.pausaChegou(codigo, vez, true);
  }

  /** O 204: a pausa (ou o fim dela) chegou à reunião, e a dúvida dela acaba. */
  private pausaChegou(codigo: string, vez: number, verdadeiro: boolean): void {
    const a = this.abertas.get(codigo);
    if (vez !== this.vez || !a) return;
    if (verdadeiro) a.falhou = false;
    a.duvida = null;
    this.publicar();
  }

  /** `conta`: a falha é da pausa que dura (o falso do fim não a conta, e não é repetido). */
  private pausaSemResposta(codigo: string, e: unknown, vez: number, epoca: number, conta: boolean): void {
    const a = this.abertas.get(codigo);
    if (vez !== this.vez || ehParado(e) || !a) return;
    if (e instanceof ErroChat && e.status === 404) {
      if (a.epoca !== epoca) return;
      this.abertas.delete(codigo);
      this.pedidos = this.pedidos.filter((p) => p.reuniao !== codigo);
      this.mudou();
    } else if (e instanceof ErroChat && e.status === 409 && e.erro === 'foraDaReuniao') {
      // Não é uma falha, e não é para sempre: a rodada seguinte tenta de novo.
      if (conta) a.falhou = false;
      this.foraDaReuniao(codigo, epoca);
    } else if (conta) {
      a.falhou = true;
    }
    this.publicar();
  }

  /** O que mudou nas reuniões: o relógio da conferência e o pedido do aviso. */
  private mudou(): void {
    const algumaDentro = [...this.abertas.values()].some((a) => a.dentro);
    if (!algumaDentro) {
      clearTimeout(this.conferencia);
      this.conferencia = undefined;
    } else if (this.conferencia === undefined) {
      this.conferencia = setTimeout(() => this.passouOTempo(), CONFERENCIA_MS);
    }
    this.mostrarNoAviso();
    this.publicar();
  }

  private passouOTempo(): void {
    this.conferencia = undefined;
    this.mudou();
    this.conferirTodas();
  }

  private conferirTodas(): void {
    for (const [codigo, a] of [...this.abertas]) if (a.dentro) void this.conferir(codigo);
  }

  /** Pede o participantes de uma reunião em que o computador está (um pedido por reunião de cada vez). */
  private async conferir(codigo: string): Promise<void> {
    const a = this.abertas.get(codigo);
    if (!a?.dentro || this.conferindo.has(codigo)) return;
    const vez = this.vez;
    const epoca = a.epoca;
    this.conferindo.add(codigo);
    try {
      const r = await this.chat.pedir((api) => api.participantesDaReuniao(codigo));
      const agora = this.abertas.get(codigo);
      if (vez !== this.vez || !agora?.dentro || agora.epoca !== epoca) return;
      // O servidor conhece o computador na reunião: o aviso de que ia desligar já não conta.
      agora.desligou = false;
      this.definirPedidos(codigo, r.pedidos);
      this.mudou();
    } catch (e) {
      if (vez !== this.vez || ehParado(e) || !(e instanceof ErroChat)) return;
      if (e.status === 409 && e.erro === 'foraDaReuniao') this.foraDaReuniao(codigo, epoca);
      else if (e.status === 404 && this.abertas.get(codigo)?.epoca === epoca) {
        this.abertas.delete(codigo);
        this.pedidos = this.pedidos.filter((p) => p.reuniao !== codigo);
        this.mudou();
      }
    } finally {
      if (vez === this.vez) this.conferindo.delete(codigo);
    }
  }

  /**
   * O pedido que o aviso mostra: o mais antigo que ainda não saiu dele, de todas as reuniões. Quando ele muda, sai o
   * reuniaoPedido (sem o pedido, se não há nenhum); o mesmo comando nunca sai duas vezes seguidas.
   */
  private mostrarNoAviso(): void {
    const p = this.pedidos.find((x) => !x.fora);
    const assunto = p ? this.abertas.get(p.reuniao)?.info?.assunto : undefined;
    const comando: ComandoDoPedido = p
      ? {
          cmd: 'reuniaoPedido',
          pedido: { id: p.id, nome: p.nome, assunto: assunto === undefined ? null : paraOAviso(assunto) },
          escondida: !(this.noApp?.codigo === p.reuniao && !this.noApp.escondida),
        }
      : { cmd: 'reuniaoPedido' };
    const chave = JSON.stringify(comando);
    if (chave === this.ultimoPedido) return;
    this.ultimoPedido = chave;
    this.bridge.send(comando);
  }

  /**
   * A resposta do aviso ao pedido dele. O pedido sai do aviso na hora (o próximo aparece); o aceitar e o recusar
   * chamam a rota como a pessoa da vez. Um pedido que o cliente não conhece, ou que já saiu do aviso, é ignorado.
   */
  async responder(id: string, resposta: RespostaDoAviso): Promise<void> {
    const p = this.pedidos.find((x) => x.id === id);
    if (!p || p.fora) return;
    p.fora = true;
    this.mostrarNoAviso();
    if (resposta === 'fechar') return;
    const vez = this.vez;
    const epoca = this.abertas.get(p.reuniao)?.epoca ?? 0;
    try {
      await this.chat.pedir((api) =>
        resposta === 'aceitar' ? api.aceitarPedido(p.reuniao, id) : api.recusarPedido(p.reuniao, id),
      );
    } catch (e) {
      if (vez !== this.vez || ehParado(e) || ehChave(e)) return;
      if (e instanceof ErroChat && e.status === 404) return;
      if (e instanceof ErroChat && e.status === 409) {
        // O jaRespondido: outro colega respondeu antes. A reunião cheia: o pedido continua esperando no servidor, mas
        // fora do aviso. O foraDaReuniao: a regra do "fora".
        if (e.erro === 'jaRespondido') return;
        if (e.erro === 'cheia') return this.avisar(REUNIAO_CHEIA);
        if (e.erro === 'foraDaReuniao') return this.foraDaReuniao(p.reuniao, epoca);
      }
      // Sem resposta, um 5xx, o 429 ou outro erro: o pedido volta ao aviso (se a reunião ainda o tem).
      this.avisar(SERVIDOR_NAO_RESPONDEU);
      if (this.pedidos.includes(p)) {
        p.fora = false;
        this.mostrarNoAviso();
      }
    }
  }
}
