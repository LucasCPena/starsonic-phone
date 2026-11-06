// O cliente do chat: fala com o servidor (a API e os eventos) como a pessoa da conta em uso, guarda a lista de conversas
// e diz às telas o que mostrar (a VistaChat). O main.tsx dá a ele o chat do estado da ponte e a conta em uso (o
// atualizar). Ele manda à ponte o chatKey (a chave vem na chatChave e fica só aqui, na memória), o chatLink e o
// chatUnlink do cartão do administrador, o número de não lidas (o chatBadge, a cada mudança) e os avisos do Windows (o
// chatNotify; o da conversa 0 é o do computador novo).
// - A partida: com o chat ligado, a conta em uso já conectada aqui e uma conta, a chave, o entrar como a pessoa do
//   ramal, as conversas e os eventos. Sem o `ligado`, a situação é `desligado`; sem a conta conectada, `precisaConta`.
// - A troca de pessoa (a conta mudou de ramal, ou o chat desligou): os eventos param e a vista esvazia (as conversas, a
//   aberta, o número e a faixa) antes de a outra entrar; a conversa aberta e os envios da pessoa de antes são soltos. O
//   que chega de antes da troca é descartado (a `vez`), e os entrar vão um de cada vez: o computador age como a pessoa
//   do último que o servidor atendeu (Review Focus 1).
// - Os erros: sem rede (também o pedido sem resposta em 20 s) ou um 500, a faixa e outra tentativa depois do
//   esperaDaVez; um 401 (a chave não vale mais, em qualquer pedido ou no bilhete) é a situação `fora`, e tudo para; um
//   429 `limite` espera o esperarSegundos (no máximo 60 s) e tenta de novo uma vez.
// - A faixa ("Sem conexão com o chat. Tentando de novo…") tem três fontes: os eventos que caíram e não voltaram, a lista
//   (a partida ou a releitura) esperando outra tentativa e a conversa aberta esperando outra tentativa de um pedido
//   dela. A da conversa sai com ela.
// - Os eventos: cada `conectou` relê as conversas (o que chega durante a releitura vale de novo por cima dela); a
//   mensagem muda a última, a hora e as não lidas da conversa e a põe no lugar dela na ordem; a `lida` zera as não
//   lidas; o computador novo mostra a faixa e o aviso do Windows.
// - (Task 6) A conversa aberta é uma Aberta (aberta.ts), nova a cada abrir; os envios, com os Pendentes de cada
//   conversa (também com ela fechada), são os Envios da pessoa da vez (envios.ts).
// - (Task 6) A leitura e o aviso: o cliente guarda o `frente` da mensagem `janela`. A aberta com a janela na frente é
//   lida na hora (as não lidas dela ficam 0); a mensagem que chega pelos eventos de outra pessoa, fora dela, pede o
//   chatNotify, se ela entrou na lista agora (a que a releitura já trouxe não pede de novo). Depois de cada queda dos
//   eventos, a releitura da volta avisa, no máximo uma vez por conversa, a última que chegou durante a queda, só se ela
//   tiver menos de 2 minutos pelo relógio do computador (R28): o app só vê a queda quando o WebSocket fecha, e depois
//   de o PC dormir isso só acontece na volta. As mais velhas ficam só no número.
// - (Task 5) Os pedidos das telas da nova conversa, do novo grupo e dos membros (os colegas, criar a dupla ou o grupo,
//   os membros, pôr, tirar e sair) vão uma vez cada, e a tela diz a falha (R31); a resposta de antes de uma troca de
//   pessoa não vale. A conversa que uma tela cria entra na lista na hora (a tela da conversa só desenha uma que está
//   nela), e o grupo de que a pessoa sai sai dela na hora. Uma conversa que sai da lista (o conversaSaiu, o sair, a
//   releitura) leva a leitura aberta dela e os Pendentes dela (R26).
// - (Task 7) Os arquivos: o enviarArquivos vai para os envios (um Pendente por arquivo, e o texto por último); as
//   miniaturas são da conversa aberta (aberta.ts); e o arquivo de uma foto (a foto grande) é um pedido da tela, como os
//   da Task 5.
import type { Bridge } from '../bridge';
import { limitCharacters } from '../format';
import type { ChatSummary } from '../state';
import { Aberta, type Miniatura } from './aberta';
import { criarApi, ehChave, ErroChat, ligarComputador, type ApiChat } from './api';
import { Envios, SEM_PENDENTES, type Pendente } from './envios';
import { conectarEventos, esperaDaVez, esperaDoLimite } from './eventos';
import { textoDoAviso, tituloDoAviso } from './formato';
import { CHAT, computadorNovo } from './textos';
import type { Conversa, Evento, Membro, Mensagem, Pessoa } from './tipos';

export type SituacaoChat = 'desligado' | 'precisaConta' | 'entrando' | 'pronto' | 'fora';

/** O Pendente (uma minha que ainda não foi) mora no envios.ts e sai também daqui, como o plano o dá à Task 7. */
export type { Pendente } from './envios';

/** A conversa na tela (Task 6): as mensagens em ordem de id e as minhas que ainda não foram. */
export interface ConversaAberta {
  id: number;
  mensagens: Mensagem[];
  temMaisAntigas: boolean;
  /** Uma página (a primeira, 50 anteriores ou uma da volta) entrou há menos de 1 s: o log fica `aria-busy`. */
  ocupada: boolean;
  /** (Task 7) As miniaturas das fotos que já chegaram, pelo id do arquivo (num blob: que vive com a conversa aberta). */
  miniaturas: ReadonlyMap<string, Miniatura>;
  pendentes: Pendente[];
}

export interface VistaChat {
  situacao: SituacaoChat;
  /**
   * false: a faixa "Sem conexão com o chat. Tentando de novo…" (os eventos caíram, ou a lista ou a conversa aberta
   * espera outra tentativa).
   */
  conectado: boolean;
  /** A pessoa da vez no servidor (null antes de entrar). */
  eu: Pessoa | null;
  /** A mais nova primeiro. */
  conversas: Conversa[];
  /** A soma das não lidas (o número da aba e do ícone da barra de tarefas). */
  naoLidas: number;
  aberta: ConversaAberta | null;
  /** O nome do outro computador em que o meu chat entrou (a faixa da lista), até o "×". */
  computadorNovo: string | null;
}

interface Conta {
  ramal: string;
  nome: string;
}

/** Quem espera um pedido de novo: a espera dele (a parada a acorda) e se ele ainda vale. */
interface Dono {
  dormir(ms: number): Promise<void>;
  ativa(): boolean;
}

/** (Task 5) A pessoa da vez, para um pedido de uma tela: a api dela, ela e a vez. */
interface Sessao {
  api: ApiChat;
  eu: Pessoa;
  vez: number;
}

/** O que muda a lista: um evento, ou (Task 5) a resposta de um criar (a conversa que a tela criou). */
type DaLista = Evento | { tipo: 'criada'; conversa: Conversa };

/** O nome da pessoa no servidor tem até 80 caracteres (docs/chat-protocolo.md, seção 3). */
const MAX_NOME = 80;
/** A mensagem que chegou durante uma queda só é avisada na volta com menos que isto de idade (o `criadaEm`). */
const IDADE_DO_AVISO_DA_VOLTA_MS = 120_000;

const VISTA_VAZIA: VistaChat = {
  situacao: 'desligado',
  conectado: true,
  eu: null,
  conversas: [],
  naoLidas: 0,
  aberta: null,
  computadorNovo: null,
};

/** O pedido ou a espera de antes de uma parada (ou de uma conversa que fechou): quem esperava desiste. */
class Parado extends Error {}

const ehLimite = (e: unknown): e is ErroChat => e instanceof ErroChat && e.status === 429 && e.erro === 'limite';

/** A ordem da lista: a conversa atualizada mais nova primeiro; no empate, a de id maior (a ordem do servidor). */
function ordenar(lista: Conversa[]): Conversa[] {
  return [...lista].sort((a, b) => b.atualizadaEm - a.atualizadaEm || b.id - a.id);
}

/**
 * Um evento na lista de conversas. Vale também por cima de uma lista que já o tem (a da releitura): a mensagem que a
 * conversa já tem (a última com o mesmo id ou um maior) não conta de novo. `reler`: a lista não basta (uma conversa que
 * ela não tem, uma leitura até antes da última). `entrou`: a mensagem entrou agora, como a última da conversa.
 */
function aplicar(
  conversas: Conversa[],
  e: DaLista,
  contaComoNaoLida: (m: Mensagem) => boolean,
): { conversas: Conversa[]; reler: boolean; entrou?: boolean } {
  switch (e.tipo) {
    case 'mensagem': {
      const m = e.mensagem;
      const c = conversas.find((x) => x.id === m.conversa);
      if (!c) return { conversas, reler: true };
      if (c.ultima && c.ultima.id >= m.id) return { conversas, reler: false };
      const nova: Conversa = { ...c, ultima: m, atualizadaEm: m.criadaEm, naoLidas: c.naoLidas + (contaComoNaoLida(m) ? 1 : 0) };
      return { conversas: ordenar(conversas.map((x) => (x === c ? nova : x))), reler: false, entrou: true };
    }
    case 'lida': {
      const c = conversas.find((x) => x.id === e.conversa);
      if (!c || c.naoLidas === 0) return { conversas, reler: false };
      if (c.ultima && e.ate >= c.ultima.id) return { conversas: conversas.map((x) => (x === c ? { ...x, naoLidas: 0 } : x)), reler: false };
      return { conversas, reler: true };
    }
    case 'conversa':
      return { conversas: ordenar([...conversas.filter((x) => x.id !== e.conversa.id), e.conversa]), reler: false };
    case 'conversaSaiu':
      return { conversas: conversas.filter((x) => x.id !== e.conversa), reler: false };
    case 'criada':
      // A resposta é de antes dos eventos que já chegaram: ela só põe a conversa que a lista ainda não tem.
      return { conversas: conversas.some((x) => x.id === e.conversa.id) ? conversas : ordenar([...conversas, e.conversa]), reler: false };
    default:
      return { conversas, reler: false };
  }
}

export class ChatCliente {
  private readonly bridge: Bridge;
  private readonly base: string;
  private v: VistaChat = VISTA_VAZIA;
  private readonly ouvintes = new Set<() => void>();
  /** O que o último atualizar trouxe. */
  private resumo: ChatSummary | undefined;
  private conta: Conta | null = null;
  /** A chave da última chatChave (só na memória); null sem ela. */
  private chave: string | null = null;
  private pedidoDaChave: { promessa: Promise<string>; resolver(chave: string): void } | null = null;
  /** O ramal da pessoa que está entrando ou que entrou; null com tudo parado. */
  private ramalDaVez: string | null = null;
  /** O servidor recusou a chave: fora do chat até ligar de novo ou desligar. */
  private fora = false;
  /** O Desligar do chat, até o estado chegar sem o `ligado`. */
  private desligando = false;
  /** Sobe a cada parada: o que vem de uma vez anterior é descartado. */
  private vez = 0;
  private eventos: { parar(): void } | null = null;
  private eventosNoAr = false;
  /** Os eventos caíram e ainda não voltaram: a faixa (antes da primeira conexão, não). */
  private semEventos = false;
  /** A lista (a partida ou a releitura) espera outra tentativa depois de um erro: a faixa. */
  private falhaDaLista = false;
  /** As esperas da sessão em curso (a parada acorda todas). */
  private readonly acordar = new Set<() => void>();
  /** A espera da sessão (a da partida, da releitura e dos envios). */
  private readonly daSessao: Dono = { dormir: (ms) => this.dormir(ms), ativa: () => true };
  /** O último entrar: o próximo só sai depois da resposta dele. */
  private filaDeEntrada: Promise<unknown> = Promise.resolve();
  /** Os eventos da lista (e as conversas criadas) que chegaram durante a releitura; null sem releitura. */
  private relendo: DaLista[] | null = null;
  private relerDeNovo = false;
  /** O último chatBadge (o C++ começa com 0). */
  private numero = 0;
  /** A api da pessoa que entrou (null fora do `pronto`). */
  private api: ApiChat | null = null;
  /** A janela principal está na frente (a última mensagem `janela`; antes da primeira, false). */
  private frente = false;
  /** Sobe a cada `conectou`: quem leu a aberta enquanto isso sabe que pode ter ficado um buraco. */
  private conexao = 0;
  /** A conversa aberta (null sem nenhuma). */
  private aberta: Aberta | null = null;
  /** Os envios da pessoa que entrou (null fora do `pronto`). */
  private envios: Envios | null = null;
  /** Até onde cada conversa já foi lida (mandada daqui ou lida em outro computador meu): o mesmo id nunca vai de novo. */
  private readonly lidas = new Map<number, number>();
  /** A queda dos eventos em curso: a última mensagem de cada conversa quando ela começou. */
  private queda: Map<number, number> | null = null;
  /**
   * Depois de uma queda, até a releitura da volta acabar: a última mensagem de cada conversa já vista (a de antes da
   * queda, ou uma que chegou pelos eventos depois dela). A releitura avisa as conversas com uma mais nova e recente.
   */
  private avisoDaVolta: Map<number, number> | null = null;

  constructor(o: { bridge: Bridge; base: string }) {
    this.bridge = o.bridge;
    this.base = o.base;
    o.bridge.subscribe((msg) => {
      if (msg.type === 'chatChave') this.chegouAChave(msg.chave);
      else if (msg.type === 'janela') this.mudouAJanela(msg.frente);
    });
  }

  vista(): VistaChat {
    return this.v;
  }

  assinar(f: () => void): () => void {
    this.ouvintes.add(f);
    return () => {
      this.ouvintes.delete(f);
    };
  }

  /** O chat do estado da ponte e a conta em uso (o ramal e o nome) mudaram. */
  atualizar(p: { chat: ChatSummary | undefined; conta: { ramal: string; nome: string } | null }): void {
    this.resumo = p.chat;
    this.conta = p.conta;
    this.reavaliar();
  }

  /** O cartão do administrador: o POST /api/v1/computadores com o código e, se o servidor ligou, o chatLink. */
  async ligarComputador(codigo: string): Promise<{ empresa: string }> {
    const { chave, empresa } = await ligarComputador(this.base, codigo.trim(), this.resumo?.computador ?? '');
    this.bridge.send({ cmd: 'chatLink', chave, empresa });
    // A chave nova volta pela chatChave, como sempre. Ligado de novo depois de sair do chat (o estado continua com o
    // `ligado`), o cliente entra já com ela; senão, quando o estado chegar ligado.
    this.chave = null;
    this.fora = false;
    this.desligando = false;
    this.reavaliar();
    return { empresa };
  }

  /** O cartão do administrador: o DELETE /api/v1/computadores/eu (mesmo sem resposta) e o chatUnlink. */
  async desligarComputador(): Promise<void> {
    this.desligando = true;
    // Os eventos param antes: o fora que o DELETE provoca não chega à tela.
    this.reavaliar();
    const chave = this.chave ?? (await this.pedirChave());
    if (chave) {
      try {
        await criarApi(this.base, chave).desligar();
      } catch {
        // Desliga aqui também sem a resposta do servidor.
      }
    }
    this.chave = null;
    this.fora = false;
    this.bridge.send({ cmd: 'chatUnlink' });
  }

  /** O "×" da faixa do computador novo. */
  dispensarComputadorNovo(): void {
    this.mudar({ computadorNovo: null });
  }

  /**
   * Abre a conversa (a que estava aberta fecha): as 50 mais novas e, com a janela na frente, a leitura. Sem conexão, a
   * faixa e outra tentativa, até dar certo, a conversa fechar ou outra pessoa entrar.
   */
  abrir(conversa: number): Promise<void> {
    this.fechar();
    this.aberta = this.criarAberta(conversa);
    this.publicarAberta();
    return this.aberta?.abrir() ?? Promise.resolve();
  }

  /** Fecha a conversa aberta: o que ainda chegar dela não pinta mais (uma mensagem a caminho continua indo). */
  fechar(): void {
    this.soltarAberta();
    this.mudar({ aberta: null });
  }

  /** As 50 anteriores à mais antiga da tela (o alto da lista apareceu). */
  anteriores(): Promise<void> {
    return this.aberta?.anteriores() ?? Promise.resolve();
  }

  /** Manda o texto na conversa aberta (não na conversa a dois com quem saiu do chat). */
  enviarTexto(texto: string): void {
    if (this.aberta && this.podeEscrever(this.aberta.id)) this.envios?.enviarTexto(this.aberta.id, texto);
  }

  /**
   * (Task 7) Manda os arquivos na conversa aberta, cada um numa mensagem, na ordem, e o texto por último (como o
   * enviarTexto, não na conversa a dois com quem saiu do chat).
   */
  enviarArquivos(arquivos: File[], texto: string): void {
    if (this.aberta && this.podeEscrever(this.aberta.id)) this.envios?.enviarArquivos(this.aberta.id, arquivos, texto);
  }

  /** O "Tentar de novo" de uma mensagem "Não enviada". */
  tentarDeNovo(idLocal: string): void {
    this.envios?.tentarDeNovo(idLocal);
  }

  /**
   * (Task 7) Os bytes de um arquivo (a foto grande), uma vez só, como um pedido de tela (R31): a resposta de antes de
   * uma troca de pessoa não vale, e o 429 `limite` espera e tenta de novo uma vez.
   */
  async baixarArquivo(id: string): Promise<Blob> {
    const s = this.sessao();
    return this.daTela(s, () => s.api.baixarArquivo(id), { lendo: true });
  }

  /** (Task 5) Os colegas da empresa que já usam o chat (sem a pessoa da vez), em ordem de nome. */
  async colegas(): Promise<Pessoa[]> {
    const s = this.sessao();
    return this.daTela(s, () => s.api.colegas(), { lendo: true });
  }

  /** (Task 5) A conversa a dois com a pessoa (a que já existe, ou uma nova), já na lista: o id dela. */
  async criarDupla(com: number): Promise<number> {
    const s = this.sessao();
    return this.naLista(s, await this.daTela(s, () => s.api.criarDupla(com)));
  }

  /** (Task 5) O grupo novo, com quem cria cuidando dele, já na lista: o id dele. */
  async criarGrupo(nome: string, pessoas: number[]): Promise<number> {
    const s = this.sessao();
    return this.naLista(s, await this.daTela(s, () => s.api.criarGrupo(nome, pessoas)));
  }

  /** (Task 5) Os membros do grupo: quem cuida primeiro, e o resto em ordem de nome. */
  async membros(conversa: number): Promise<Membro[]> {
    const s = this.sessao();
    return this.daTela(s, () => s.api.membros(conversa), { lendo: true, conversa });
  }

  /** (Task 5) Põe as pessoas no grupo (só quem cuida); a lista muda pelo evento `conversa`. */
  async por(conversa: number, pessoas: number[]): Promise<void> {
    const s = this.sessao();
    await this.daTela(s, () => s.api.porMembros(conversa, pessoas), { conversa });
  }

  /** (Task 5) Tira a pessoa do grupo (só quem cuida); a lista muda pelo evento `conversa`. */
  async tirar(conversa: number, pessoa: number): Promise<void> {
    const s = this.sessao();
    await this.daTela(s, () => s.api.tirarMembro(conversa, pessoa), { conversa });
  }

  /** (Task 5) Sai do grupo: ele sai da lista na hora, sem esperar o `conversaSaiu` (R26). */
  async sair(conversa: number): Promise<void> {
    const s = this.sessao();
    await this.daTela(s, () => s.api.tirarMembro(conversa, s.eu.id), { conversa });
    this.aplicarNaLista({ tipo: 'conversaSaiu', conversa }, s.api);
  }

  /** A situação pelo último atualizar; com outra pessoa (ou nenhuma), a troca. */
  private reavaliar(): void {
    const chat = this.resumo;
    if (!chat?.ligado) {
      // Desligado (ou sem o chat no estado: o iPhone): nem a chave fica.
      this.chave = null;
      this.fora = false;
      this.desligando = false;
      this.trocar('desligado');
    } else if (this.desligando) {
      this.trocar('desligado');
    } else if (this.fora) {
      this.trocar('fora');
    } else if (!chat.contaConectada || !this.conta) {
      this.trocar('precisaConta');
    } else if (this.ramalDaVez !== this.conta.ramal) {
      const conta = this.conta;
      this.trocar('entrando');
      void this.iniciar(conta);
    }
  }

  /** Para tudo e começa a vista de novo, vazia, na situação dada (já nela, nada muda; o `entrando` é sempre outra pessoa). */
  private trocar(situacao: SituacaoChat): void {
    if (situacao !== 'entrando' && this.v.situacao === situacao) return;
    this.parar();
    this.mudar({ ...VISTA_VAZIA, situacao });
  }

  private parar(): void {
    this.vez++;
    this.ramalDaVez = null;
    this.api = null;
    this.eventos?.parar();
    this.eventos = null;
    this.eventosNoAr = false;
    this.semEventos = false;
    this.falhaDaLista = false;
    this.relendo = null;
    this.relerDeNovo = false;
    this.queda = null;
    this.avisoDaVolta = null;
    this.soltarAberta();
    this.envios?.soltar();
    this.envios = null;
    this.lidas.clear();
    for (const acordar of [...this.acordar]) acordar();
  }

  /** A partida, como a pessoa da conta: até dar certo, até a chave não valer ou até a próxima parada. */
  private async iniciar(conta: Conta): Promise<void> {
    const vez = this.vez;
    this.ramalDaVez = conta.ramal;
    const nome = limitCharacters(conta.nome.trim() || conta.ramal, MAX_NOME);
    for (let tentativa = 0; ; tentativa++) {
      try {
        const chave = this.chave ?? (await this.pedirChave());
        if (vez !== this.vez) return;
        if (!chave) {
          // O C++ não tem a chave (o estado ainda dizia ligado): o próximo estado diz o que fazer.
          this.trocar('desligado');
          return;
        }
        const api = criarApi(this.base, chave);
        const eu = await this.entrarEmOrdem(vez, api, conta.ramal, nome);
        if (vez !== this.vez) return;
        const conversas = await this.comLimite(vez, () => api.conversas());
        if (vez !== this.vez) return;
        this.api = api;
        this.envios = this.criarEnvios(vez, api, eu);
        this.falhaDaLista = false;
        this.mudar({ situacao: 'pronto', eu, conversas: ordenar(conversas) });
        this.ligarEventos(vez, api);
        return;
      } catch (e) {
        if (!(await this.esperarDepoisDoErro(vez, e, tentativa, this.falhouALista))) return;
      }
    }
  }

  /** A lista (a partida ou a releitura) espera outra tentativa: a faixa, até ela dar certo. */
  private readonly falhouALista = (): void => {
    this.falhaDaLista = true;
    this.mudar({});
  };

  /**
   * O erro de um pedido que se tenta até dar certo (a partida, a releitura das conversas e as páginas da conversa
   * aberta): um 401 é a situação `fora`, e tudo para; o resto (sem rede, um 500), a faixa de quem pediu (o `falhou`) e a
   * espera da vez, na espera dele (a da conversa aberta acaba quando ela fecha). `true`: tente de novo, a espera passou;
   * `false`: desista (veio outra vez, quem pediu não vale mais, ou o computador saiu do chat).
   */
  private async esperarDepoisDoErro(vez: number, e: unknown, tentativa: number, falhou: () => void, dono: Dono = this.daSessao): Promise<boolean> {
    if (vez !== this.vez || e instanceof Parado || !dono.ativa()) return false;
    if (ehChave(e)) {
      this.sairDoChat();
      return false;
    }
    falhou();
    await dono.dormir(esperaDaVez(tentativa, Math.random()));
    return vez === this.vez && dono.ativa();
  }

  /** O entrar, um de cada vez: o próximo só sai depois da resposta do anterior (e não sai depois de uma parada). */
  private entrarEmOrdem(vez: number, api: ApiChat, ramal: string, nome: string): Promise<Pessoa> {
    const pedido = this.filaDeEntrada.then(() => {
      if (vez !== this.vez) throw new Parado();
      return this.comLimite(vez, () => api.entrar(ramal, nome));
    });
    this.filaDeEntrada = pedido.catch(() => undefined);
    return pedido;
  }

  /**
   * Um pedido com o 429 `limite`: espera o esperarSegundos (no máximo 60 s), na espera de quem pede, e tenta de novo uma
   * vez, se o pedido ainda vale.
   */
  private async comLimite<T>(vez: number, pedir: () => Promise<T>, dono: Dono = this.daSessao): Promise<T> {
    const vale = () => vez === this.vez && dono.ativa();
    try {
      return await pedir();
    } catch (e) {
      if (!ehLimite(e)) throw e;
      // Uma parada durante o pedido não acorda uma espera que começa depois dela: sem isto, um 429 atrasado de antes de
      // uma troca seguraria a fila do entrar por até 60 s (e o de uma conversa que fechou pediria a página de novo).
      if (!vale()) throw new Parado();
      await dono.dormir(esperaDoLimite(e));
      if (!vale()) throw new Parado();
      return pedir();
    }
  }

  /** Espera `ms`, ou até a próxima parada (quem esperava confere a `vez`). */
  private dormir(ms: number): Promise<void> {
    return new Promise((pronto) => {
      const acordar = () => {
        clearTimeout(espera);
        this.acordar.delete(acordar);
        pronto();
      };
      const espera = setTimeout(acordar, ms);
      this.acordar.add(acordar);
    });
  }

  private ligarEventos(vez: number, api: ApiChat): void {
    const desta = (f: () => void) => () => {
      if (vez === this.vez) f();
    };
    this.eventos = conectarEventos(this.base, api, {
      evento: (e) => {
        if (vez === this.vez) this.aoEvento(e, api);
      },
      conectou: desta(() => {
        // Depois de uma queda (de qualquer tamanho: o app pode tê-la visto só agora), a releitura avisa o que chegou
        // durante ela e ainda é recente.
        if (this.queda) this.avisoDaVolta = this.queda;
        this.queda = null;
        this.eventosNoAr = true;
        this.semEventos = false;
        this.conexao += 1;
        this.mudar({});
        void this.reler(vez, api);
        this.aberta?.conectou();
      }),
      caiu: desta(() => {
        // Cada tentativa que não abre também é um `caiu`: a queda começa no primeiro.
        if (this.eventosNoAr) this.comecarAQueda();
        this.eventosNoAr = false;
        this.semEventos = true;
        // Sem os eventos, a aberta pode perder uma mensagem: o `ate` dela para até a volta.
        this.aberta?.caiu();
        this.mudar({});
      }),
      fora: desta(() => this.sairDoChat()),
    });
  }

  /**
   * A queda dos eventos começou: a última mensagem de cada conversa. Uma queda antes de a releitura da volta anterior
   * acabar continua do que ela tinha (o que chegou na queda de antes ainda não foi avisado).
   */
  private comecarAQueda(): void {
    this.queda = this.avisoDaVolta ?? new Map(this.v.conversas.map((c): [number, number] => [c.id, c.ultima?.id ?? 0]));
    this.avisoDaVolta = null;
  }

  /** A chave não vale mais (o 401, o fora, o 4001): tudo para, até ligar de novo ou desligar. */
  private sairDoChat(): void {
    this.fora = true;
    this.trocar('fora');
  }

  /**
   * Relê as conversas (a cada conexão dos eventos, e quando um evento não basta). Os eventos que chegam durante a
   * releitura valem de novo por cima da lista nova, na ordem em que chegaram: a resposta pode ser de antes deles.
   */
  private async reler(vez: number, api: ApiChat): Promise<void> {
    if (this.relendo) {
      this.relerDeNovo = true;
      return;
    }
    this.relendo = [];
    for (let tentativa = 0; ; tentativa++) {
      try {
        const lidas = await this.comLimite(vez, () => api.conversas());
        if (vez !== this.vez) return;
        let conversas = ordenar(lidas);
        let deNovo = this.relerDeNovo;
        for (const e of this.relendo ?? []) {
          const r = aplicar(conversas, e, this.contaComoNaoLida);
          conversas = r.conversas;
          deNovo ||= r.reler;
        }
        this.relendo = null;
        this.relerDeNovo = false;
        this.falhaDaLista = false;
        this.mudarALista(conversas);
        if (deNovo) void this.reler(vez, api);
        else this.avisarDaVolta();
        return;
      } catch (e) {
        if (!(await this.esperarDepoisDoErro(vez, e, tentativa, this.falhouALista))) return;
      }
    }
  }

  /**
   * A releitura depois de uma queda: um aviso por conversa, com a última dela, se ela chegou durante a queda (a que
   * chegou pelos eventos depois dela já foi avisada) e tem menos de 2 minutos pelo relógio do computador. O avisar não
   * avisa as minhas, os avisos de grupo nem a conversa lida na hora.
   */
  private avisarDaVolta(): void {
    const vistas = this.avisoDaVolta;
    this.avisoDaVolta = null;
    if (!vistas) return;
    const agora = Date.now();
    for (const c of this.v.conversas) {
      const m = c.ultima;
      if (m && m.id > (vistas.get(c.id) ?? 0) && agora - m.criadaEm < IDADE_DO_AVISO_DA_VOLTA_MS) this.avisar(m);
    }
  }

  private aoEvento(e: Evento, api: ApiChat): void {
    if (e.tipo === 'computadorNovo') {
      this.mudar({ computadorNovo: e.computador });
      this.bridge.send({ cmd: 'chatNotify', conversa: 0, titulo: CHAT, texto: computadorNovo(e.computador) });
      return;
    }
    const entrou = this.aplicarNaLista(e, api);
    if (e.tipo === 'mensagem') {
      const m = e.mensagem;
      if (this.aberta?.id === m.conversa) this.aberta.chegou(m, true);
      this.envios?.chegaram([m]);
      const vistas = this.avisoDaVolta;
      if (vistas) vistas.set(m.conversa, Math.max(vistas.get(m.conversa) ?? 0, m.id));
      // Só a que entrou na lista agora: a que a releitura já trouxe (e talvez já avisou) não pede outro aviso.
      if (entrou) this.avisar(m);
    } else if (e.tipo === 'lida') {
      this.lidas.set(e.conversa, Math.max(this.lidas.get(e.conversa) ?? 0, e.ate));
    }
  }

  /**
   * Um evento (ou a resposta de um envio, de um criar ou de um sair) na lista de conversas, também por cima da releitura
   * em curso. true: a mensagem entrou agora, como a última da conversa.
   */
  private aplicarNaLista(e: DaLista, api: ApiChat): boolean {
    this.relendo?.push(e);
    const r = aplicar(this.v.conversas, e, this.contaComoNaoLida);
    this.mudarALista(r.conversas);
    if (r.reler) void this.reler(this.vez, api);
    return r.entrou === true;
  }

  /**
   * A lista nova (de um evento, de uma releitura, de um criar ou de um sair). Uma conversa que saiu dela leva a leitura
   * aberta dela e os Pendentes dela (R26); as telas dela voltam para a lista pelo main.tsx.
   */
  private mudarALista(conversas: Conversa[]): void {
    const ficam = new Set(conversas.map((c) => c.id));
    const fechar = this.aberta !== null && !ficam.has(this.aberta.id);
    if (fechar) this.soltarAberta();
    for (const c of this.v.conversas) if (!ficam.has(c.id)) this.envios?.soltarConversa(c.id);
    this.mudar(fechar ? { conversas, aberta: null } : { conversas });
  }

  /** (Task 5) A sessão de agora, para um pedido de uma tela; fora do `pronto`, o Parado (a tela não diz nada). */
  private sessao(): Sessao {
    const { api } = this;
    const eu = this.v.eu;
    if (!api || !eu) throw new Parado();
    return { api, eu, vez: this.vez };
  }

  /**
   * (Task 5) Um pedido de uma tela, uma vez só. Uma troca de pessoa no meio é o Parado (a resposta não vale); um 401 é
   * o `fora`; um 404 de um grupo relê a lista, que o tira se ele não é mais da pessoa (e as telas dele voltam para a
   * lista, R26). O erro vai para a tela, que diz a falha (R31). `lendo`: uma leitura, em que o 429 `limite` espera e
   * tenta de novo uma vez, como nos pedidos que o cliente faz sozinho; numa ação, a tela diz o 429.
   */
  private async daTela<T>(s: Sessao, pedir: () => Promise<T>, o: { lendo?: boolean; conversa?: number } = {}): Promise<T> {
    let r: T;
    try {
      r = await (o.lendo ? this.comLimite(s.vez, pedir) : pedir());
    } catch (e) {
      if (s.vez !== this.vez || e instanceof Parado) throw new Parado();
      if (ehChave(e)) this.sairDoChat();
      else if (o.conversa !== undefined && e instanceof ErroChat && e.status === 404) void this.reler(s.vez, s.api);
      throw e;
    }
    if (s.vez !== this.vez) throw new Parado();
    return r;
  }

  /**
   * (Task 5) A conversa que uma tela criou (ou a dupla que já existia) entra na lista, se ainda não está nela: a tela da
   * conversa só desenha uma conversa da lista. O id dela.
   */
  private naLista(s: Sessao, c: Conversa): number {
    this.aplicarNaLista({ tipo: 'criada', conversa: c }, s.api);
    return c.id;
  }

  /**
   * A mensagem conta nas não lidas: nem as minhas nem os avisos de grupo contam (como no servidor), nem a da conversa
   * lida na hora (aberta, com a janela na frente).
   */
  private readonly contaComoNaoLida = (m: Mensagem): boolean =>
    m.tipo !== 'aviso' && m.autor?.id !== this.v.eu?.id && !this.lidaNaHora(m.conversa);

  /** A conversa está aberta com a janela na frente: o que chega nela já é visto. */
  private lidaNaHora(conversa: number): boolean {
    return this.frente && this.aberta?.id === conversa;
  }

  /**
   * O aviso do Windows de uma mensagem que chegou (pelos eventos, ou na releitura depois de uma queda curta): nunca para
   * as minhas (também as do meu outro computador), para os avisos de grupo nem para a conversa lida na hora.
   */
  private avisar(m: Mensagem): void {
    if (m.tipo === 'aviso' || m.autor?.id === this.v.eu?.id || this.lidaNaHora(m.conversa)) return;
    // A conversa nova chega antes da primeira mensagem dela (o evento `conversa`).
    const c = this.v.conversas.find((x) => x.id === m.conversa);
    if (c) this.bridge.send({ cmd: 'chatNotify', conversa: m.conversa, titulo: tituloDoAviso(c, m), texto: textoDoAviso(m) });
  }

  /** A janela foi para a frente ou saiu dela. Na frente, a aberta passa a ser lida (as não lidas dela saem no mudar). */
  private mudouAJanela(frente: boolean): void {
    if (frente === this.frente) return;
    this.frente = frente;
    this.mudar({});
    this.aberta?.ler();
  }

  /** A conversa está na lista, e não é a conversa a dois com quem saiu do chat. */
  private podeEscrever(conversa: number): boolean {
    const c = this.v.conversas.find((x) => x.id === conversa);
    return c !== undefined && !(c.tipo === 'dupla' && c.com.saiu);
  }

  /** A abertura da conversa, com o que ela usa do cliente, da pessoa de agora (null fora do `pronto`). */
  private criarAberta(conversa: number): Aberta | null {
    const api = this.api;
    if (!api) return null;
    const vez = this.vez;
    const daVez = () => vez === this.vez;
    const aberta: Aberta = new Aberta(conversa, {
      api,
      daVez,
      eventosNoAr: () => this.eventosNoAr,
      conexao: () => this.conexao,
      frente: () => this.frente,
      lidas: this.lidas,
      publicar: () => {
        if (aberta === this.aberta) this.publicarAberta();
      },
      comLimite: (pedir) => this.comLimite(vez, pedir, aberta),
      esperarDepoisDoErro: (e, tentativa, falhou) => this.esperarDepoisDoErro(vez, e, tentativa, falhou, aberta),
      reler: () => {
        if (daVez()) void this.reler(vez, api);
      },
      chegaram: (mensagens) => {
        if (daVez()) this.envios?.chegaram(mensagens);
      },
      sairDoChat: () => {
        if (daVez()) this.sairDoChat();
      },
    });
    return aberta;
  }

  /** Os envios da pessoa que entrou: soltos na próxima parada. */
  private criarEnvios(vez: number, api: ApiChat, eu: Pessoa): Envios {
    return new Envios({
      api,
      eu: eu.id,
      comLimite: (pedir) => this.comLimite(vez, pedir),
      publicar: (conversa) => {
        if (vez === this.vez && this.aberta?.id === conversa) this.publicarAberta();
      },
      chegou: (m) => {
        if (vez !== this.vez) return;
        this.aplicarNaLista({ tipo: 'mensagem', mensagem: m }, api);
        if (this.aberta?.id === m.conversa) this.aberta.chegou(m, false);
      },
      sairDoChat: () => {
        if (vez === this.vez) this.sairDoChat();
      },
    });
  }

  /** Solta a conversa aberta: as esperas dela acabam, e o que ainda chegar dela não pinta. */
  private soltarAberta(): void {
    this.aberta?.soltar();
    this.aberta = null;
  }

  /** A conversa aberta na vista (as mensagens dela e os meus Pendentes nela), e a faixa, que pode ter mudado com ela. */
  private publicarAberta(): void {
    const a = this.aberta;
    if (!a) return;
    const antes = this.v.aberta;
    const agora: ConversaAberta = { id: a.id, ...a.vista(), pendentes: this.envios?.de(a.id) ?? SEM_PENDENTES };
    const igual = antes !== null && (Object.keys(agora) as Array<keyof ConversaAberta>).every((k) => agora[k] === antes[k]);
    this.mudar(igual ? {} : { aberta: agora });
  }

  /** Pede a chave ao C++ (o chatKey); a resposta é a chatChave ("" fora do chat). Um pedido de cada vez. */
  private pedirChave(): Promise<string> {
    if (!this.pedidoDaChave) {
      let resolver: (chave: string) => void = () => {};
      const promessa = new Promise<string>((r) => (resolver = r));
      this.pedidoDaChave = { promessa, resolver };
      this.bridge.send({ cmd: 'chatKey' });
    }
    return this.pedidoDaChave.promessa;
  }

  private chegouAChave(chave: string): void {
    const pedido = this.pedidoDaChave;
    if (!pedido) return;
    this.pedidoDaChave = null;
    this.chave = chave || null;
    pedido.resolver(chave);
  }

  /**
   * A vista nova (a faixa pelas três fontes; o número é sempre a soma das não lidas, e a conversa lida na hora fica com
   * 0, também depois de uma releitura); o chatBadge sai quando o número muda.
   */
  private mudar(parte: Partial<VistaChat>): void {
    const antes = this.v;
    const v: VistaChat = { ...antes, ...parte };
    v.conectado = !(this.semEventos || this.falhaDaLista || (this.aberta?.falhando() ?? false));
    const aberta = this.frente ? v.aberta?.id : undefined;
    if (aberta !== undefined && v.conversas.some((c) => c.id === aberta && c.naoLidas > 0)) {
      v.conversas = v.conversas.map((c) => (c.id === aberta ? { ...c, naoLidas: 0 } : c));
    }
    v.naoLidas = v.conversas.reduce((soma, c) => soma + c.naoLidas, 0);
    if ((Object.keys(v) as Array<keyof VistaChat>).every((k) => v[k] === antes[k])) return;
    this.v = v;
    if (v.naoLidas !== this.numero) {
      this.numero = v.naoLidas;
      this.bridge.send({ cmd: 'chatBadge', n: v.naoLidas });
    }
    for (const f of [...this.ouvintes]) f();
  }
}
