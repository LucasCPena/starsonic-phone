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
// - Os erros: sem rede ou um 500, o `conectado` fica false e há outra tentativa depois do esperaDaVez; um 401 (a chave
//   não vale mais, em qualquer pedido ou no bilhete) é a situação `fora`, e tudo para; um 429 `limite` espera o
//   esperarSegundos (no máximo 60 s) e tenta de novo uma vez.
// - Os eventos: cada `conectou` relê as conversas (o que chega durante a releitura vale de novo por cima dela); a
//   mensagem muda a última, a hora e as não lidas da conversa e a põe no lugar dela na ordem; a `lida` zera as não
//   lidas; o computador novo mostra a faixa e o aviso do Windows.
// As Tasks 5 a 7 acrescentam as conversas novas, os grupos, a conversa aberta, o envio e os arquivos.
import type { Bridge } from '../bridge';
import { limitCharacters } from '../format';
import type { ChatSummary } from '../state';
import { criarApi, ErroChat, ligarComputador, type ApiChat } from './api';
import { conectarEventos, esperaDaVez, esperaDoLimite } from './eventos';
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

  constructor(o: { bridge: Bridge; base: string }) {
    this.bridge = o.bridge;
    this.base = o.base;
    o.bridge.subscribe((msg) => {
      if (msg.type === 'chatChave') this.chegouAChave(msg.chave);
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
    this.eventos?.parar();
    this.eventos = null;
    this.eventosNoAr = false;
    this.relendo = null;
    this.relerDeNovo = false;
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
        const conversas = await this.comLimite(vez, () => api.conversas());
        if (vez !== this.vez) return;
        this.mudar({ situacao: 'pronto', conectado: true, eu, conversas: ordenar(conversas) });
        this.ligarEventos(vez, api);
        return;
      } catch (e) {
        if (vez !== this.vez || e instanceof Parado) return;
        if (ehChave(e)) {
          this.sairDoChat();
          return;
        }
        this.mudar({ conectado: false });
        await this.dormir(esperaDaVez(tentativa, Math.random()));
        if (vez !== this.vez) return;
      }
    }
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
        this.mudar({ conectado: true });
        void this.reler(vez, api);
      }),
      caiu: desta(() => {
        this.eventosNoAr = false;
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
        if (vez !== this.vez || e instanceof Parado) return;
        if (ehChave(e)) {
          this.sairDoChat();
          return;
        }
        this.mudar({ conectado: false });
        await this.dormir(esperaDaVez(tentativa, Math.random()));
        if (vez !== this.vez) return;
      }
    }
  }

  private aoEvento(e: Evento, api: ApiChat): void {
    if (e.tipo === 'computadorNovo') {
      this.mudar({ computadorNovo: e.computador });
      this.bridge.send({ cmd: 'chatNotify', conversa: 0, titulo: CHAT, texto: computadorNovo(e.computador) });
      return;
    }
    this.relendo?.push(e);
    const r = aplicar(this.v.conversas, e, this.contaComoNaoLida);
    this.mudar({ conversas: r.conversas });
    if (r.reler) void this.reler(this.vez, api);
  }

  /**
   * A mensagem conta nas não lidas: nem as minhas nem os avisos de grupo contam (como no servidor). A Task 6 tira
   * também a da conversa lida na hora (aberta, com a janela na frente).
   */
  private readonly contaComoNaoLida = (m: Mensagem): boolean => m.tipo !== 'aviso' && m.autor?.id !== this.v.eu?.id;

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

  /** A vista nova (o número é sempre a soma das não lidas); o chatBadge sai quando o número muda. */
  private mudar(parte: Partial<VistaChat>): void {
    const antes = this.v;
    const v: VistaChat = { ...antes, ...parte };
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
