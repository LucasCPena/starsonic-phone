// Os envios (Task 6): as minhas mensagens de cada conversa que ainda não chegaram ao servidor ("Enviando…") ou que
// ficaram "Não enviada". Eles são da pessoa da vez, e não da tela: com a conversa fechada, o envio continua; a que
// chega sai daqui (e a mensagem fica na lista), e a que não foi aparece "Não enviada" quando a conversa abrir de novo.
// A troca de pessoa solta todos (o cliente faz outros para a próxima).
// - Um Pendente sai quando chega a mensagem dele (o mesmo idLocal), pela resposta, pelo evento ou por uma página da
//   conversa aberta, o que vier primeiro. Sem resposta em 15 s, ou com um erro, ele fica "Não enviada", e o "Tentar de
//   novo" manda o mesmo idLocal (o servidor guarda uma mensagem só por idLocal).
// - (Task 5) Uma conversa que sai da lista (um grupo de que a pessoa saiu ou foi tirada) leva os Pendentes dela: os
//   prazos param, e o que ainda chegar dos envios dela não vale (R26).
// (Task 7) Os arquivos também vão por aqui.
import { ehChave, type ApiChat } from './api';
import type { Mensagem } from './tipos';

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

/** A conversa sem Pendentes: sempre a mesma lista (a vista não muda à toa). Ninguém a altera. */
export const SEM_PENDENTES: Pendente[] = [];

/**
 * Sem resposta em 15 s, a mensagem fica "Não enviada". O pedido continua até o prazo do api.ts (20 s): a resposta que
 * chega nesse meio ainda vale.
 */
const PRAZO_DO_ENVIO_MS = 15_000;

/** O que os envios usam do cliente, da pessoa da vez. */
export interface ContextoDosEnvios {
  api: ApiChat;
  /** O id da pessoa da vez: as mensagens dela com um idLocal são as dos Pendentes. */
  eu: number;
  /** O pedido com o 429 `limite` (espera o esperarSegundos e tenta de novo uma vez). */
  comLimite<T>(pedir: () => Promise<T>): Promise<T>;
  /** Os Pendentes da conversa mudaram. */
  publicar(conversa: number): void;
  /** A mensagem de um envio chegou pela resposta: na lista e, se ela estiver aberta, na conversa. */
  chegou(m: Mensagem): void;
  /** O 401: o computador saiu do chat. */
  sairDoChat(): void;
}

export class Envios {
  private readonly ctx: ContextoDosEnvios;
  /** Os Pendentes de cada conversa, na ordem em que foram escritos (só as conversas com algum). */
  private readonly porConversa = new Map<number, Pendente[]>();
  /** O envio em curso de cada Pendente: a tentativa de agora e o prazo dos 15 s dela. */
  private readonly tentativas = new Map<string, { tentativa: number; prazo: ReturnType<typeof setTimeout> }>();
  /** A pessoa trocou: nada do que chega daqui em diante vale. */
  private solto = false;
  /** Os idLocal dos Pendentes de uma conversa que saiu da lista: a resposta que ainda chegar deles não vale. */
  private readonly descartados = new Set<string>();

  constructor(ctx: ContextoDosEnvios) {
    this.ctx = ctx;
  }

  /** Os Pendentes da conversa (a mesma lista enquanto eles não mudam). */
  de(conversa: number): Pendente[] {
    return this.porConversa.get(conversa) ?? SEM_PENDENTES;
  }

  /** Manda o texto: um Pendente "Enviando…", com um idLocal novo. Um texto só de espaços não sai. */
  enviarTexto(conversa: number, texto: string): void {
    if (this.solto || !texto.trim()) return;
    const p: Pendente = { idLocal: crypto.randomUUID(), conversa, tipo: 'texto', texto, estado: 'enviando' };
    this.mudar(conversa, [...this.de(conversa), p]);
    this.mandar(p);
  }

  /** O "Tentar de novo" de uma mensagem "Não enviada": o mesmo idLocal. */
  tentarDeNovo(idLocal: string): void {
    const p = this.achar(idLocal);
    if (this.solto || !p || p.estado !== 'naoEnviada') return;
    const deNovo: Pendente = { ...p, estado: 'enviando' };
    this.trocar(p, deNovo);
    this.mandar(deNovo);
  }

  /** Mensagens que chegaram (pela resposta, pelo evento ou numa página): os meus Pendentes que viraram uma delas saem. */
  chegaram(mensagens: Mensagem[]): void {
    const eu = this.ctx.eu;
    const minhas = new Set(mensagens.flatMap((m) => (m.idLocal !== null && m.autor?.id === eu ? [m.idLocal] : [])));
    if (this.solto || minhas.size === 0) return;
    for (const [conversa, lista] of [...this.porConversa]) {
      const ficam = lista.filter((p) => !minhas.has(p.idLocal));
      if (ficam.length === lista.length) continue;
      for (const p of lista) if (minhas.has(p.idLocal)) this.soltarEnvio(p.idLocal);
      this.mudar(conversa, ficam);
    }
  }

  /** A conversa saiu da lista (R26): os Pendentes dela saem, os prazos param, e o que ainda chegar deles não vale. */
  soltarConversa(conversa: number): void {
    const lista = this.porConversa.get(conversa);
    if (this.solto || !lista) return;
    for (const p of lista) {
      this.soltarEnvio(p.idLocal);
      this.descartados.add(p.idLocal);
    }
    this.mudar(conversa, []);
  }

  /** A troca de pessoa: os prazos param, os Pendentes saem, e o que ainda chegar dos envios não vale. */
  soltar(): void {
    this.solto = true;
    for (const { prazo } of this.tentativas.values()) clearTimeout(prazo);
    this.tentativas.clear();
    this.porConversa.clear();
  }

  /**
   * Um envio do Pendente: sem resposta em 15 s, ou com um erro, ele fica "Não enviada"; a resposta que chega depois dos
   * 15 s ainda vale. Uma tentativa nova toma o lugar da anterior (o prazo e o erro da de antes não valem mais).
   */
  private mandar(p: Pendente): void {
    const texto = p.texto;
    if (texto === undefined) return;
    const antes = this.tentativas.get(p.idLocal);
    if (antes) clearTimeout(antes.prazo);
    const tentativa = (antes?.tentativa ?? 0) + 1;
    const naoFoi = () => this.naoEnviada(p.idLocal, tentativa);
    this.tentativas.set(p.idLocal, { tentativa, prazo: setTimeout(naoFoi, PRAZO_DO_ENVIO_MS) });
    this.ctx.comLimite(() => this.ctx.api.enviar(p.conversa, { idLocal: p.idLocal, texto })).then(
      (m) => {
        if (this.solto || this.descartados.has(p.idLocal)) return;
        this.ctx.chegou(m);
        this.chegaram([m]);
      },
      (e) => {
        // Solto, o erro é da troca de pessoa (ou de um pedido dela): não vale mais.
        if (this.solto) return;
        if (ehChave(e)) this.ctx.sairDoChat();
        else naoFoi();
      },
    );
  }

  /** A tentativa não foi (o prazo de 15 s ou um erro): o Pendente fica "Não enviada", se ela ainda é a de agora. */
  private naoEnviada(idLocal: string, tentativa: number): void {
    const envio = this.tentativas.get(idLocal);
    if (this.solto || envio?.tentativa !== tentativa) return;
    clearTimeout(envio.prazo);
    const p = this.achar(idLocal);
    if (p && p.estado !== 'naoEnviada') this.trocar(p, { ...p, estado: 'naoEnviada' });
  }

  /** O Pendente virou mensagem: o envio dele acabou. */
  private soltarEnvio(idLocal: string): void {
    const envio = this.tentativas.get(idLocal);
    if (envio) clearTimeout(envio.prazo);
    this.tentativas.delete(idLocal);
  }

  private achar(idLocal: string): Pendente | undefined {
    for (const lista of this.porConversa.values()) {
      const p = lista.find((x) => x.idLocal === idLocal);
      if (p) return p;
    }
    return undefined;
  }

  private trocar(p: Pendente, novo: Pendente): void {
    this.mudar(p.conversa, this.de(p.conversa).map((x) => (x === p ? novo : x)));
  }

  private mudar(conversa: number, lista: Pendente[]): void {
    if (lista.length === 0) this.porConversa.delete(conversa);
    else this.porConversa.set(conversa, lista);
    this.ctx.publicar(conversa);
  }
}
