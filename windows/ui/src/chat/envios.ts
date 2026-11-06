// Os envios (Task 6): as minhas mensagens de cada conversa que ainda não chegaram ao servidor ("Enviando…") ou que
// ficaram "Não enviada". Eles são da pessoa da vez, e não da tela: com a conversa fechada, o envio continua; a que
// chega sai daqui (e a mensagem fica na lista), e a que não foi aparece "Não enviada" quando a conversa abrir de novo.
// A troca de pessoa solta todos (o cliente faz outros para a próxima).
// - Um Pendente sai quando chega a mensagem dele (o mesmo idLocal), pela resposta, pelo evento ou por uma página da
//   conversa aberta, o que vier primeiro. Sem resposta em 15 s, ou com um erro, ele fica "Não enviada", e o "Tentar de
//   novo" manda o mesmo idLocal (o servidor guarda uma mensagem só por idLocal).
// - (Task 5) Uma conversa que sai da lista (um grupo de que a pessoa saiu ou foi tirada) leva os Pendentes dela: os
//   prazos param, e o que ainda chegar dos envios dela não vale (R26).
// - (Task 7) Os arquivos: cada um vira uma mensagem, com o upload (o progresso fica no Pendente), a miniatura de uma
//   foto e o POST da mensagem com o arquivo. Os de um Enviar vão um depois do outro, na ordem, e o texto dele por
//   último: o servidor dá os ids na ordem em que as mensagens chegam a ele. Os 15 s contam desde o último progresso
//   (cada pedaço do upload, e cada passo, recomeçam a conta). O "Tentar de novo" manda só o que faltou (o upload, a
//   miniatura, a mensagem), com o mesmo idLocal, e desiste do upload de antes que ainda estiver indo; a conversa que
//   sai da lista e a troca de pessoa também desistem dele. Uma miniatura que falha não segura a mensagem.
import { ehChave, ErroChat, type ApiChat } from './api';
import { ehFoto } from './formato';
import { fazerMiniatura } from './miniatura';
import type { Arquivo, Mensagem } from './tipos';

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
 * Sem resposta em 15 s (num arquivo, sem progresso em 15 s), a mensagem fica "Não enviada". O pedido continua até o
 * prazo do api.ts (20 s): a resposta que chega nesse meio ainda vale.
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

/** (Task 7) O que o envio de um arquivo já fez: o "Tentar de novo" manda só o que falta. */
interface EnvioDeArquivo {
  dados: File;
  /** O arquivo no servidor, depois do upload; null: falta o upload. */
  id: string | null;
  /** A miniatura já foi, ou não há o que mandar (não é uma foto, ou a foto não abre): só falta a mensagem. */
  miniatura: boolean;
  /** Desiste do upload em curso (o de uma tentativa que não é mais a de agora). */
  cancelar: AbortController | null;
  /** A conversa saiu da lista (R26): o que ainda chegar deste envio não vale. */
  descartado: boolean;
}

export class Envios {
  private readonly ctx: ContextoDosEnvios;
  /** Os Pendentes de cada conversa, na ordem em que foram escritos (só as conversas com algum). */
  private readonly porConversa = new Map<number, Pendente[]>();
  /** O envio em curso de cada Pendente: a tentativa de agora e o prazo dos 15 s dela. */
  private readonly tentativas = new Map<string, { tentativa: number; prazo: ReturnType<typeof setTimeout> }>();
  /** (Task 7) O que cada envio de arquivo já fez, até a mensagem dele chegar ou ele sair. */
  private readonly arquivos = new Map<string, EnvioDeArquivo>();
  /** A pessoa trocou: nada do que chega daqui em diante vale. */
  private solto = false;
  /** Os idLocal dos Pendentes de texto de uma conversa que saiu da lista: a resposta que ainda chegar deles não vale. */
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
    const p = novoTexto(conversa, texto);
    this.mudar(conversa, [...this.de(conversa), p]);
    void this.mandar(p);
  }

  /**
   * (Task 7) Manda os arquivos, cada um numa mensagem, e o texto (se não for só de espaços) por último: um Pendente
   * "Enviando…" para cada um, na ordem, e um envio de cada vez.
   */
  enviarArquivos(conversa: number, arquivos: File[], texto: string): void {
    if (this.solto) return;
    const novos = arquivos.map((dados): Pendente => {
      const tipo = dados.type || 'application/octet-stream';
      const p: Pendente = {
        idLocal: crypto.randomUUID(),
        conversa,
        tipo: 'arquivo',
        arquivo: { nome: dados.name, tamanho: dados.size, tipo, foto: ehFoto(tipo) },
        estado: 'enviando',
        progresso: 0,
      };
      this.arquivos.set(p.idLocal, { dados, id: null, miniatura: false, cancelar: null, descartado: false });
      return p;
    });
    if (texto.trim()) novos.push(novoTexto(conversa, texto));
    if (novos.length === 0) return;
    this.mudar(conversa, [...this.de(conversa), ...novos]);
    void novos.reduce((fila, p) => fila.then(() => this.mandarNaVez(p.idLocal)), Promise.resolve());
  }

  /** O "Tentar de novo" de uma mensagem "Não enviada": o mesmo idLocal. */
  tentarDeNovo(idLocal: string): void {
    const p = this.achar(idLocal);
    if (this.solto || !p || p.estado !== 'naoEnviada') return;
    const deNovo: Pendente = { ...p, estado: 'enviando' };
    this.trocar(p, deNovo);
    void this.mandar(deNovo);
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
      // O arquivo leva a marca no envio dele (que sai daqui com ele); o texto fica nos descartados.
      const arquivo = this.arquivos.get(p.idLocal);
      if (arquivo) arquivo.descartado = true;
      else this.descartados.add(p.idLocal);
      this.soltarEnvio(p.idLocal);
    }
    this.mudar(conversa, []);
  }

  /** A troca de pessoa: os prazos param, os uploads param, os Pendentes saem, e o que ainda chegar dos envios não vale. */
  soltar(): void {
    this.solto = true;
    for (const { prazo } of this.tentativas.values()) clearTimeout(prazo);
    this.tentativas.clear();
    for (const { cancelar } of this.arquivos.values()) cancelar?.abort();
    this.arquivos.clear();
    this.porConversa.clear();
  }

  /** (Task 7) O próximo de um Enviar, quando o de antes dele acabou: só se ele ainda está aqui (não saiu com a conversa). */
  private mandarNaVez(idLocal: string): Promise<void> {
    const p = this.achar(idLocal);
    return this.solto || !p ? Promise.resolve() : this.mandar(p);
  }

  /**
   * Um envio do Pendente: sem resposta em 15 s (num arquivo, sem progresso), ou com um erro, ele fica "Não enviada"; a
   * resposta que chega depois dos 15 s ainda vale. Uma tentativa nova toma o lugar da anterior (o prazo e o erro da de
   * antes não valem mais). Acaba quando os pedidos da tentativa acabam (a fila de um Enviar espera por ela).
   */
  private mandar(p: Pendente): Promise<void> {
    const antes = this.tentativas.get(p.idLocal);
    if (antes) clearTimeout(antes.prazo);
    const tentativa = (antes?.tentativa ?? 0) + 1;
    this.tentativas.set(p.idLocal, { tentativa, prazo: setTimeout(() => this.naoEnviada(p.idLocal, tentativa), PRAZO_DO_ENVIO_MS) });
    const envio = this.arquivos.get(p.idLocal);
    if (envio) return this.mandarArquivo(p, envio, tentativa);
    const texto = p.texto ?? '';
    return this.ctx.comLimite(() => this.ctx.api.enviar(p.conversa, { idLocal: p.idLocal, texto })).then(
      (m) => {
        if (this.solto || this.descartados.has(p.idLocal)) return;
        this.ctx.chegou(m);
        this.chegaram([m]);
      },
      (e) => this.falhou(p.idLocal, tentativa, e),
    );
  }

  /**
   * (Task 7) Um envio de arquivo, do que falta: o upload (com o progresso), a miniatura de uma foto (a que falha não
   * segura a mensagem) e o POST da mensagem com o arquivo. Cada passo só começa se a tentativa ainda é a de agora (e o
   * envio ainda está aqui); a resposta da mensagem vale como a do texto.
   */
  private async mandarArquivo(p: Pendente, envio: EnvioDeArquivo, tentativa: number): Promise<void> {
    const vale = () => !this.solto && this.arquivos.get(p.idLocal) === envio && this.tentativas.get(p.idLocal)?.tentativa === tentativa;
    let id = envio.id;
    try {
      if (id === null) {
        // Uma tentativa de antes que ainda manda o arquivo desiste: o upload recomeça aqui.
        envio.cancelar?.abort();
        const cancelar = new AbortController();
        envio.cancelar = cancelar;
        const tipo = p.arquivo?.tipo ?? 'application/octet-stream';
        const andou = (fracao: number) => {
          if (vale()) this.andou(p.idLocal, tentativa, fracao);
        };
        let arquivo: Arquivo;
        try {
          arquivo = await this.ctx.comLimite(() => this.ctx.api.enviarArquivo(envio.dados, envio.dados.name, tipo, andou, cancelar.signal));
        } finally {
          if (envio.cancelar === cancelar) envio.cancelar = null;
        }
        if (!vale()) return;
        id = arquivo.id;
        envio.id = id;
        // O servidor decide se é uma foto (pelo tipo do upload): só a foto tem miniatura.
        envio.miniatura = !arquivo.foto;
        this.andou(p.idLocal, tentativa, 1);
      }
      if (!envio.miniatura) {
        const jpeg = await fazerMiniatura(envio.dados);
        if (!vale()) return;
        // A foto que não abre fica sem miniatura (o quadro no balão); a que o servidor não recebeu fica para a próxima.
        envio.miniatura = jpeg === null || (await this.mandouAMiniatura(id, jpeg));
        if (!vale()) return;
        this.andou(p.idLocal, tentativa);
      }
      const doArquivo = id;
      const m = await this.ctx.comLimite(() => this.ctx.api.enviar(p.conversa, { idLocal: p.idLocal, arquivo: doArquivo }));
      if (this.solto || envio.descartado) return;
      this.ctx.chegou(m);
      this.chegaram([m]);
    } catch (e) {
      // O arquivo do upload já não vale (expirou, ou saiu do servidor 24 horas depois sem mensagem): a próxima
      // tentativa manda o upload de novo.
      if (e instanceof ErroChat && e.status === 400 && e.campo === 'arquivo' && envio.id === id) {
        envio.id = null;
        envio.miniatura = false;
      }
      this.falhou(p.idLocal, tentativa, e);
    }
  }

  /** (Task 7) O PUT da miniatura. false: ele falhou (sem rede, um 5xx…), e ela não segura a mensagem; o 401 passa. */
  private async mandouAMiniatura(id: string, jpeg: Blob): Promise<boolean> {
    try {
      await this.ctx.comLimite(() => this.ctx.api.enviarMiniatura(id, jpeg));
      return true;
    } catch (e) {
      if (ehChave(e)) throw e;
      return false;
    }
  }

  /** A tentativa deu erro: um 401 é o `fora`; o resto, "Não enviada" (se ela ainda é a de agora). */
  private falhou(idLocal: string, tentativa: number, e: unknown): void {
    // Solto, o erro é da troca de pessoa (ou de um pedido dela): não vale mais.
    if (this.solto) return;
    if (ehChave(e)) this.ctx.sairDoChat();
    else this.naoEnviada(idLocal, tentativa);
  }

  /**
   * (Task 7) O envio andou (um pedaço do upload, ou um passo): os 15 s recomeçam. Com o `progresso`, ele vai para o
   * Pendente, a cada ponto percentual.
   */
  private andou(idLocal: string, tentativa: number, progresso?: number): void {
    const envio = this.tentativas.get(idLocal);
    if (this.solto || envio?.tentativa !== tentativa) return;
    clearTimeout(envio.prazo);
    envio.prazo = setTimeout(() => this.naoEnviada(idLocal, tentativa), PRAZO_DO_ENVIO_MS);
    const p = this.achar(idLocal);
    if (p && progresso !== undefined && Math.round(progresso * 100) !== Math.round((p.progresso ?? 0) * 100)) {
      this.trocar(p, { ...p, progresso });
    }
  }

  /** A tentativa não foi (o prazo de 15 s ou um erro): o Pendente fica "Não enviada", se ela ainda é a de agora. */
  private naoEnviada(idLocal: string, tentativa: number): void {
    const envio = this.tentativas.get(idLocal);
    if (this.solto || envio?.tentativa !== tentativa) return;
    clearTimeout(envio.prazo);
    const p = this.achar(idLocal);
    if (p && p.estado !== 'naoEnviada') this.trocar(p, { ...p, estado: 'naoEnviada' });
  }

  /** O Pendente virou mensagem (ou saiu): o envio dele acabou, e o upload que ainda estiver indo desiste. */
  private soltarEnvio(idLocal: string): void {
    const envio = this.tentativas.get(idLocal);
    if (envio) clearTimeout(envio.prazo);
    this.tentativas.delete(idLocal);
    this.arquivos.get(idLocal)?.cancelar?.abort();
    this.arquivos.delete(idLocal);
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

/** Um Pendente de texto "Enviando…", com um idLocal novo. */
function novoTexto(conversa: number, texto: string): Pendente {
  return { idLocal: crypto.randomUUID(), conversa, tipo: 'texto', texto, estado: 'enviando' };
}
