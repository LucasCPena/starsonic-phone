// O cliente do chat: fala com o servidor (a API e os eventos) como a pessoa da conta em uso, guarda a lista de conversas
// e diz às telas o que mostrar (a VistaChat). O main.tsx dá a ele o chat do estado da ponte e a conta em uso (o
// atualizar). Ele manda à ponte o chatKey (a chave vem na chatChave e fica só aqui, na memória), o chatLink e o
// chatUnlink do cartão do administrador, o número de não lidas (o chatBadge, a cada mudança) e o aviso do computador
// novo (o chatNotify da conversa 0).
// - A partida: com o chat ligado, a conta em uso já conectada aqui e uma conta, a chave, o entrar como a pessoa do
//   ramal, as conversas e os eventos. Sem o `ligado`, a situação é `desligado`; sem a conta conectada, `precisaConta`.
// - A troca de pessoa (a conta mudou de ramal, ou o chat desligou): os eventos param e a vista esvazia (as conversas, a
//   aberta, o número e a faixa) antes de a outra entrar. O que chega de antes da troca é descartado (a `vez`), e os
//   entrar vão um de cada vez: o computador age como a pessoa do último que o servidor atendeu (Review Focus 1).
// - Os erros: sem rede (também o pedido sem resposta em 20 s) ou um 500, o `conectado` fica false e há outra tentativa
//   depois do esperaDaVez; um 401 (a chave não vale mais, em qualquer pedido ou no bilhete) é a situação `fora`, e tudo
//   para; um 429 `limite` espera o esperarSegundos (no máximo 60 s) e tenta de novo uma vez.
// - Os eventos: cada `conectou` relê as conversas (o que chega durante a releitura vale de novo por cima dela); a
//   mensagem muda a última, a hora e as não lidas da conversa e a põe no lugar dela na ordem; a `lida` zera as não
//   lidas; o computador novo mostra a faixa e o aviso do Windows.
// - (Task 6) A conversa aberta (a tela Conversa abre e fecha): as 50 mais novas, as anteriores de 50 em 50 e, a cada
//   `conectou`, a volta (as de depois da última que ela tem sem buraco, até o temMais dar false). As mensagens ficam em
//   ordem de id, e um id repetido não entra. O que chega de outra abertura (a `Leitura` de cada abrir) ou de outra
//   pessoa (a `vez`) nunca pinta na de agora.
// - (Task 6) O envio: um Pendente "Enviando…" com um idLocal novo, que sai quando chega a mensagem dele (pela resposta ou
//   pelo evento); sem resposta em 15 s, ou com um erro, "Não enviada", e o "Tentar de novo" manda o mesmo idLocal.
// - (Task 6) A leitura e o aviso: o cliente guarda o `frente` da mensagem `janela`. A aberta com a janela na frente é
//   lida na hora (o marcarLida até a mais nova, um id uma vez só, e as não lidas dela ficam 0); a mensagem que chega de
//   outra pessoa, fora dela, pede o chatNotify.
// As Tasks 5 e 7 acrescentam as conversas novas, os grupos e os arquivos.
import type { Bridge } from '../bridge';
import { limitCharacters } from '../format';
import type { ChatSummary } from '../state';
import { criarApi, ErroChat, ligarComputador, type ApiChat } from './api';
import { conectarEventos, esperaDaVez, esperaDoLimite } from './eventos';
import { textoDoAviso, tituloDoAviso } from './formato';
import { CHAT, computadorNovo } from './textos';
import type { Conversa, Evento, Mensagem, Pessoa } from './tipos';

export type SituacaoChat = 'desligado' | 'precisaConta' | 'entrando' | 'pronto' | 'fora';

/** Uma mensagem minha que ainda não chegou ao servidor ("Enviando…") ou que ficou "Não enviada" (Tasks 6 e 7). */
export interface Pendente {
  idLocal: string;
  conversa: number;
  tipo: 'texto' | 'arquivo';
  texto?: string;
  arquivo?: { nome: string; tamanho: number; tipo: string; foto: boolean };
  estado: 'enviando' | 'naoEnviada';
  /** O envio do arquivo, de 0 a 1. */
  progresso?: number;
}

/** A conversa na tela (Task 6): as mensagens em ordem de id e as minhas que ainda não foram. */
export interface ConversaAberta {
  id: number;
  mensagens: Mensagem[];
  temMaisAntigas: boolean;
  pendentes: Pendente[];
}

export interface VistaChat {
  situacao: SituacaoChat;
  /** false: sem conexão com o servidor, tentando de novo (a faixa "Sem conexão com o chat. Tentando de novo…"). */
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

/** O nome da pessoa no servidor tem até 80 caracteres (docs/chat-protocolo.md, seção 3). */
const MAX_NOME = 80;
/**
 * Sem resposta em 15 s, a mensagem fica "Não enviada". O pedido continua até o prazo do api.ts (20 s): a resposta que
 * chega nesse meio ainda vale.
 */
const PRAZO_DO_ENVIO_MS = 15_000;

/** O que o cliente sabe da conversa aberta além da vista: uma nova a cada abrir (quem esperava confere se é a dela). */
interface Leitura {
  /** A primeira página chegou. */
  carregada: boolean;
  /**
   * Até esta mensagem, a aberta tem todas, sem buraco: a volta da conexão busca as de depois dela. null: nenhuma (a
   * primeira página veio vazia, e a volta lê as mais novas).
   */
  ate: number | null;
  /** Os eventos estão no ar desde que o `ate` fechou sem buraco: cada mensagem que chega por eles o avança. */
  continuo: boolean;
  buscandoDepois: boolean;
  buscandoAnteriores: boolean;
  /** O envio em curso de cada Pendente: a tentativa de agora e o prazo dos 15 s dela. */
  envios: Map<string, { tentativa: number; prazo: ReturnType<typeof setTimeout> }>;
}

const VISTA_VAZIA: VistaChat = {
  situacao: 'desligado',
  conectado: true,
  eu: null,
  conversas: [],
  naoLidas: 0,
  aberta: null,
  computadorNovo: null,
};

/** O pedido ou a espera de antes de uma parada: quem esperava desiste. */
class Parado extends Error {}

const ehChave = (e: unknown) => e instanceof ErroChat && e.status === 401;
const ehLimite = (e: unknown): e is ErroChat => e instanceof ErroChat && e.status === 429 && e.erro === 'limite';

/** A ordem da lista: a conversa atualizada mais nova primeiro; no empate, a de id maior (a ordem do servidor). */
function ordenar(lista: Conversa[]): Conversa[] {
  return [...lista].sort((a, b) => b.atualizadaEm - a.atualizadaEm || b.id - a.id);
}

/** As mensagens com as novas, em ordem de id: um id que já está não entra de novo (a mesma lista, se nada entrou). */
function juntarPorId(lista: Mensagem[], novas: Mensagem[]): Mensagem[] {
  const ids = new Set(lista.map((m) => m.id));
  const entram = novas.filter((m) => !ids.has(m.id) && ids.add(m.id));
  return entram.length === 0 ? lista : [...lista, ...entram].sort((x, y) => x.id - y.id);
}

/** O id da última de uma lista em ordem de id (a página do servidor vem da mais antiga para a mais nova). */
const ultimoId = (lista: Mensagem[]): number | null => lista.at(-1)?.id ?? null;

/**
 * Um evento na lista de conversas. Vale também por cima de uma lista que já o tem (a da releitura): a mensagem que a
 * conversa já tem (a última com o mesmo id ou um maior) não conta de novo. `reler`: a lista não basta (uma conversa que
 * ela não tem, uma leitura até antes da última).
 */
function aplicar(conversas: Conversa[], e: Evento, contaComoNaoLida: (m: Mensagem) => boolean): { conversas: Conversa[]; reler: boolean } {
  switch (e.tipo) {
    case 'mensagem': {
      const m = e.mensagem;
      const c = conversas.find((x) => x.id === m.conversa);
      if (!c) return { conversas, reler: true };
      if (c.ultima && c.ultima.id >= m.id) return { conversas, reler: false };
      const nova: Conversa = { ...c, ultima: m, atualizadaEm: m.criadaEm, naoLidas: c.naoLidas + (contaComoNaoLida(m) ? 1 : 0) };
      return { conversas: ordenar(conversas.map((x) => (x === c ? nova : x))), reler: false };
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
  /** As esperas em curso (a parada acorda todas). */
  private readonly acordar = new Set<() => void>();
  /** O último entrar: o próximo só sai depois da resposta dele. */
  private filaDeEntrada: Promise<unknown> = Promise.resolve();
  /** Os eventos da lista que chegaram durante a releitura; null sem releitura. */
  private relendo: Evento[] | null = null;
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
  private leitura: Leitura | null = null;
  /** Até onde cada conversa já foi lida (mandada daqui ou lida em outro computador meu): o mesmo id nunca vai de novo. */
  private readonly lidas = new Map<number, number>();

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
  async abrir(conversa: number): Promise<void> {
    this.fechar();
    const api = this.api;
    if (!api) return;
    const vez = this.vez;
    const l: Leitura = { carregada: false, ate: null, continuo: false, buscandoDepois: false, buscandoAnteriores: false, envios: new Map() };
    this.leitura = l;
    this.mudar({ aberta: { id: conversa, mensagens: [], temMaisAntigas: false, pendentes: [] } });
    const noArAntes = this.eventosNoAr;
    const conexao = this.conexao;
    for (let tentativa = 0; ; tentativa++) {
      try {
        const r = await this.comLimite(vez, () => api.mensagens(conversa, {}));
        if (!this.aindaAberta(vez, l)) return;
        l.carregada = true;
        // Com os eventos no ar do começo ao fim, o que veio depois da página chegou por eles; senão, a volta busca o que
        // pode ter ficado entre a página e eles (já, ou no próximo `conectou`).
        l.continuo = noArAntes && this.eventosNoAr && this.conexao === conexao;
        this.juntarNaAberta(r.mensagens, r.temMais);
        l.ate = ultimoId(l.continuo ? this.v.aberta!.mensagens : r.mensagens);
        if (tentativa > 0) this.mudar({ conectado: this.eventosNoAr });
        this.lerAberta();
        if (!l.continuo && this.eventosNoAr) void this.buscarDepois(vez, l, api);
        return;
      } catch (e) {
        if (!(await this.depoisDoErroDaAberta(vez, l, api, e, tentativa))) return;
      }
    }
  }

  /** Fecha a conversa aberta: o que ainda chegar dela não pinta mais (uma mensagem a caminho continua indo). */
  fechar(): void {
    this.soltarLeitura();
    this.mudar({ aberta: null });
  }

  /** As 50 anteriores à mais antiga da tela (o alto da lista apareceu). Uma de cada vez; sem rede, na próxima vez. */
  async anteriores(): Promise<void> {
    const l = this.leitura;
    const a = this.v.aberta;
    const api = this.api;
    const primeira = a?.mensagens[0];
    if (!l || !a || !api || !primeira || !l.carregada || !a.temMaisAntigas || l.buscandoAnteriores) return;
    const vez = this.vez;
    l.buscandoAnteriores = true;
    try {
      const r = await this.comLimite(vez, () => api.mensagens(a.id, { antes: primeira.id }));
      if (this.aindaAberta(vez, l)) this.juntarNaAberta(r.mensagens, r.temMais);
    } catch (e) {
      if (vez === this.vez && ehChave(e)) this.sairDoChat();
    } finally {
      l.buscandoAnteriores = false;
    }
  }

  /** Manda o texto na conversa aberta: um Pendente "Enviando…", com um idLocal novo. Um texto só de espaços não sai. */
  enviarTexto(texto: string): void {
    const a = this.v.aberta;
    const c = a && this.v.conversas.find((x) => x.id === a.id);
    if (!a || !c || !texto.trim() || (c.tipo === 'dupla' && c.com.saiu)) return;
    const p: Pendente = { idLocal: crypto.randomUUID(), conversa: a.id, tipo: 'texto', texto, estado: 'enviando' };
    this.mudar({ aberta: { ...a, pendentes: [...a.pendentes, p] } });
    this.mandar(p);
  }

  /** O "Tentar de novo" de uma mensagem "Não enviada": o mesmo idLocal (o servidor guarda uma mensagem só por idLocal). */
  tentarDeNovo(idLocal: string): void {
    const a = this.v.aberta;
    const p = a?.pendentes.find((x) => x.idLocal === idLocal);
    if (!a || !p || p.estado !== 'naoEnviada') return;
    const deNovo: Pendente = { ...p, estado: 'enviando' };
    this.mudar({ aberta: { ...a, pendentes: a.pendentes.map((x) => (x === p ? deNovo : x)) } });
    this.mandar(deNovo);
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
    this.relendo = null;
    this.relerDeNovo = false;
    this.soltarLeitura();
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
        this.mudar({ situacao: 'pronto', conectado: true, eu, conversas: ordenar(conversas) });
        this.ligarEventos(vez, api);
        return;
      } catch (e) {
        if (!(await this.esperarDepoisDoErro(vez, e, tentativa))) return;
      }
    }
  }

  /**
   * O erro de um pedido que se tenta até dar certo (a partida, a releitura das conversas e as páginas da conversa
   * aberta): um 401 é a situação `fora`, e tudo para; o resto (sem rede, um 500), a faixa e a espera da vez. `true`:
   * tente de novo, a espera passou; `false`: desista (veio outra vez, ou o computador saiu do chat).
   */
  private async esperarDepoisDoErro(vez: number, e: unknown, tentativa: number): Promise<boolean> {
    if (vez !== this.vez || e instanceof Parado) return false;
    if (ehChave(e)) {
      this.sairDoChat();
      return false;
    }
    this.mudar({ conectado: false });
    await this.dormir(esperaDaVez(tentativa, Math.random()));
    return vez === this.vez;
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

  /** Um pedido com o 429 `limite`: espera o esperarSegundos (no máximo 60 s) e tenta de novo uma vez. */
  private async comLimite<T>(vez: number, pedir: () => Promise<T>): Promise<T> {
    try {
      return await pedir();
    } catch (e) {
      if (!ehLimite(e)) throw e;
      // Uma parada durante o pedido não acorda uma espera que começa depois dela: sem isto, um 429 atrasado de antes de
      // uma troca seguraria a fila do entrar por até 60 s.
      if (vez !== this.vez) throw new Parado();
      await this.dormir(esperaDoLimite(e));
      if (vez !== this.vez) throw new Parado();
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
        this.eventosNoAr = true;
        this.conexao += 1;
        this.mudar({ conectado: true });
        void this.reler(vez, api);
        if (this.leitura) void this.buscarDepois(vez, this.leitura, api);
      }),
      caiu: desta(() => {
        this.eventosNoAr = false;
        // Sem os eventos, a aberta pode perder uma mensagem: o `ate` para até a volta.
        if (this.leitura) this.leitura.continuo = false;
        this.mudar({ conectado: false });
      }),
      fora: desta(() => this.sairDoChat()),
    });
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
        this.mudar({ conversas, conectado: this.eventosNoAr });
        if (deNovo) void this.reler(vez, api);
        return;
      } catch (e) {
        if (!(await this.esperarDepoisDoErro(vez, e, tentativa))) return;
      }
    }
  }

  private aoEvento(e: Evento, api: ApiChat): void {
    if (e.tipo === 'computadorNovo') {
      this.mudar({ computadorNovo: e.computador });
      this.bridge.send({ cmd: 'chatNotify', conversa: 0, titulo: CHAT, texto: computadorNovo(e.computador) });
      return;
    }
    this.aplicarNaLista(e, api);
    if (e.tipo === 'mensagem') {
      const m = e.mensagem;
      const l = this.leitura;
      if (l && this.v.aberta?.id === m.conversa) {
        this.juntarNaAberta([m]);
        if (l.continuo) l.ate = Math.max(l.ate ?? m.id, m.id);
        this.lerAberta();
      }
      this.avisar(m);
    } else if (e.tipo === 'lida') {
      this.lidas.set(e.conversa, Math.max(this.lidas.get(e.conversa) ?? 0, e.ate));
    }
  }

  /** Um evento (ou a resposta de um envio) na lista de conversas, também por cima da releitura em curso. */
  private aplicarNaLista(e: Evento, api: ApiChat): void {
    this.relendo?.push(e);
    const r = aplicar(this.v.conversas, e, this.contaComoNaoLida);
    this.mudar({ conversas: r.conversas });
    if (r.reler) void this.reler(this.vez, api);
  }

  /**
   * A mensagem conta nas não lidas: nem as minhas nem os avisos de grupo contam (como no servidor), nem a da conversa
   * lida na hora (aberta, com a janela na frente).
   */
  private readonly contaComoNaoLida = (m: Mensagem): boolean =>
    m.tipo !== 'aviso' && m.autor?.id !== this.v.eu?.id && !this.lidaNaHora(m.conversa);

  /** A conversa está aberta com a janela na frente: o que chega nela já é visto. */
  private lidaNaHora(conversa: number): boolean {
    return this.frente && this.v.aberta?.id === conversa;
  }

  /**
   * O aviso do Windows da mensagem que chegou pelos eventos: nunca para as minhas (também as do meu outro computador),
   * para os avisos de grupo nem para a conversa lida na hora.
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
    this.lerAberta();
  }

  /** A conversa da Leitura continua aberta, para a mesma pessoa. */
  private aindaAberta(vez: number, l: Leitura): boolean {
    return vez === this.vez && l === this.leitura;
  }

  /** Esquece a conversa aberta: o que esperava por ela desiste, e os prazos dos 15 s param. */
  private soltarLeitura(): void {
    const l = this.leitura;
    this.leitura = null;
    if (l) for (const { prazo } of l.envios.values()) clearTimeout(prazo);
  }

  /**
   * O erro de uma página da aberta: um 404 (a conversa não é mais minha) relê a lista, que a tira, e desiste; o resto
   * como no esperarDepoisDoErro. `true`: tente de novo.
   */
  private async depoisDoErroDaAberta(vez: number, l: Leitura, api: ApiChat, e: unknown, tentativa: number): Promise<boolean> {
    if (!this.aindaAberta(vez, l)) return false;
    if (e instanceof ErroChat && e.status === 404) {
      void this.reler(vez, api);
      return false;
    }
    return (await this.esperarDepoisDoErro(vez, e, tentativa)) && this.aindaAberta(vez, l);
  }

  /**
   * A volta da conexão da aberta (a cada `conectou`, ou depois de uma primeira página que pode ter deixado um buraco):
   * as mensagens de depois do `ate`, até o temMais dar false. Uma de cada vez: se os eventos religam enquanto ela lê,
   * ela lê de novo no fim. As que chegam pelos eventos no meio dela não avançam o `ate` (pode haver um buraco antes).
   */
  private async buscarDepois(vez: number, l: Leitura, api: ApiChat): Promise<void> {
    if (!l.carregada || l.buscandoDepois) return;
    l.buscandoDepois = true;
    try {
      for (;;) {
        const conexao = this.conexao;
        if (!(await this.lerDepois(vez, l, api))) return;
        if (this.conexao !== conexao) continue;
        // Sem buraco até a mais nova, com os eventos no ar desde antes da última página: eles avançam o `ate` de novo.
        l.continuo = this.eventosNoAr;
        if (l.continuo) l.ate = ultimoId(this.v.aberta!.mensagens);
        this.lerAberta();
        return;
      }
    } finally {
      l.buscandoDepois = false;
    }
  }

  /** As páginas de uma volta, do `ate` até o temMais dar false (sem o `ate`, as mais novas). false: desista. */
  private async lerDepois(vez: number, l: Leitura, api: ApiChat): Promise<boolean> {
    const conversa = this.v.aberta!.id;
    let falhou = false;
    for (let tentativa = 0; ; ) {
      try {
        const depois = l.ate;
        const r = await this.comLimite(vez, () => api.mensagens(conversa, depois === null ? {} : { depois }));
        if (!this.aindaAberta(vez, l)) return false;
        if (falhou) this.mudar({ conectado: this.eventosNoAr });
        falhou = false;
        tentativa = 0;
        // Sem o `ate` (a aberta estava vazia): as mais novas, e as anteriores a elas vêm pelo alto da lista.
        this.juntarNaAberta(r.mensagens, depois === null ? r.temMais : undefined);
        l.ate = ultimoId(r.mensagens) ?? depois;
        if (depois === null || !r.temMais) return true;
      } catch (e) {
        if (!(await this.depoisDoErroDaAberta(vez, l, api, e, tentativa++))) return false;
        falhou = true;
      }
    }
  }

  /**
   * As mensagens na aberta, em ordem de id (um id que já está não entra), e os meus Pendentes que viraram uma delas saem
   * (o mesmo idLocal, pela resposta ou pelo evento, o que vier primeiro). `temMaisAntigas`: o da página que chegou.
   */
  private juntarNaAberta(novas: Mensagem[], temMaisAntigas?: boolean): void {
    const a = this.v.aberta;
    const l = this.leitura;
    if (!a || !l) return;
    const eu = this.v.eu?.id;
    const chegaram = new Set(novas.filter((m) => m.idLocal !== null && m.autor?.id === eu).map((m) => m.idLocal));
    const pendentes = a.pendentes.filter((p) => !chegaram.has(p.idLocal));
    for (const p of a.pendentes) if (chegaram.has(p.idLocal)) this.soltarEnvio(l, p.idLocal);
    const mensagens = juntarPorId(a.mensagens, novas);
    const maisAntigas = temMaisAntigas ?? a.temMaisAntigas;
    if (mensagens === a.mensagens && pendentes.length === a.pendentes.length && maisAntigas === a.temMaisAntigas) return;
    this.mudar({ aberta: { ...a, mensagens, pendentes, temMaisAntigas: maisAntigas } });
  }

  /**
   * Um envio do Pendente: sem resposta em 15 s, ou com um erro, ele fica "Não enviada"; a resposta que chega depois dos
   * 15 s ainda vale. Uma tentativa nova toma o lugar da anterior (o prazo e o erro da de antes não valem mais).
   */
  private mandar(p: Pendente): void {
    const l = this.leitura;
    const api = this.api;
    const texto = p.texto;
    if (!l || !api || texto === undefined) return;
    const vez = this.vez;
    const antes = l.envios.get(p.idLocal);
    if (antes) clearTimeout(antes.prazo);
    const tentativa = (antes?.tentativa ?? 0) + 1;
    const naoFoi = () => this.naoEnviada(l, p.idLocal, tentativa);
    l.envios.set(p.idLocal, { tentativa, prazo: setTimeout(naoFoi, PRAZO_DO_ENVIO_MS) });
    this.comLimite(vez, () => api.enviar(p.conversa, { idLocal: p.idLocal, texto })).then(
      (m) => {
        if (vez !== this.vez) return;
        this.aplicarNaLista({ tipo: 'mensagem', mensagem: m }, api);
        if (this.v.aberta?.id === m.conversa) this.juntarNaAberta([m]);
      },
      (e) => {
        if (vez !== this.vez || e instanceof Parado) return;
        if (ehChave(e)) this.sairDoChat();
        else naoFoi();
      },
    );
  }

  /** A tentativa não foi (o prazo de 15 s ou um erro): o Pendente fica "Não enviada", se ela ainda é a de agora. */
  private naoEnviada(l: Leitura, idLocal: string, tentativa: number): void {
    const envio = l.envios.get(idLocal);
    if (l !== this.leitura || envio?.tentativa !== tentativa) return;
    clearTimeout(envio.prazo);
    const a = this.v.aberta;
    const p = a?.pendentes.find((x) => x.idLocal === idLocal);
    if (!a || !p || p.estado === 'naoEnviada') return;
    const naoEnviada: Pendente = { ...p, estado: 'naoEnviada' };
    this.mudar({ aberta: { ...a, pendentes: a.pendentes.map((x) => (x === p ? naoEnviada : x)) } });
  }

  /** O Pendente virou mensagem: o envio dele acabou. */
  private soltarEnvio(l: Leitura, idLocal: string): void {
    const envio = l.envios.get(idLocal);
    if (envio) clearTimeout(envio.prazo);
    l.envios.delete(idLocal);
  }

  /**
   * A leitura da aberta, com a janela na frente (a abertura, a mensagem que chega, o `frente` que vira true): o
   * marcarLida até a mais nova. Um id nunca vai duas vezes; a leitura que não chegou ao servidor fica para a próxima vez.
   */
  private lerAberta(): void {
    const a = this.v.aberta;
    const api = this.api;
    const ate = a ? ultimoId(a.mensagens) : null;
    if (!this.frente || !a || !api || ate === null) return;
    const antes = this.lidas.get(a.id) ?? 0;
    if (ate <= antes) return;
    this.lidas.set(a.id, ate);
    const vez = this.vez;
    api.marcarLida(a.id, ate).catch((e) => {
      if (vez !== this.vez) return;
      if (ehChave(e)) this.sairDoChat();
      else if (this.lidas.get(a.id) === ate) this.lidas.set(a.id, antes);
    });
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
   * A vista nova (o número é sempre a soma das não lidas, e a conversa lida na hora fica com 0, também depois de uma
   * releitura); o chatBadge sai quando o número muda.
   */
  private mudar(parte: Partial<VistaChat>): void {
    const antes = this.v;
    const v: VistaChat = { ...antes, ...parte };
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
