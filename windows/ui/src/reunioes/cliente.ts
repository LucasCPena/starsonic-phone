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
//   no clipboard e faz a vista dizer o `copiado` (a linha da reunião diz "Link copiado") por 2 s.
// Nada de uma reunião vai ao console.
import type { Bridge } from '../bridge';
import { ErroChat } from '../chat/api';
import { ehParado, type ChatCliente } from '../chat/cliente';
import type { Reuniao } from './tipos';

export interface VistaReunioes {
  /** A aba aparece: false até a primeira leitura dar certo, e de novo depois de um 403 semReunioes. */
  aba: boolean;
  /** As reuniões da pessoa da vez; null antes da primeira leitura. */
  lista: Reuniao[] | null;
  /** false: a frase da falta de conexão no lugar da lista. */
  conectado: boolean;
  /** O código da reunião cuja linha diz "Link copiado" (por 2 s); null sem nenhuma. */
  copiado: string | null;
}

/** A lista é lida de novo a esta distância, com a aba à vista (e depois de uma falha). */
export const RELEITURA_MS = 30_000;
/** A pergunta que a aba escondida pelo semReunioes repete. */
export const PERGUNTA_DE_NOVO_MS = 300_000;
/** O "Link copiado" da linha dura isto. */
export const LINK_COPIADO_MS = 2_000;

const ehSemReunioes = (e: unknown): boolean => e instanceof ErroChat && e.status === 403 && e.erro === 'semReunioes';

export class ReunioesCliente {
  private readonly chat: ChatCliente;
  private readonly ouvintes = new Set<() => void>();
  private aba = false;
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
  private v: VistaReunioes;

  constructor(o: { chat: ChatCliente; bridge: Bridge; base: string }) {
    this.chat = o.chat;
    this.v = this.montar();
    // O `conectado` depende do chat estar pronto e conectado.
    o.chat.assinar(() => this.publicar());
    o.chat.assinarSessao({
      evento: () => {},
      conectou: () => void this.ler(),
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

  private montar(): VistaReunioes {
    const c = this.chat.vista();
    return {
      aba: this.aba,
      lista: this.lista,
      conectado: c.situacao === 'pronto' && c.conectado && !this.falhou,
      copiado: this.copiado,
    };
  }

  /** Diz às telas, se a vista mudou. Uma leitura que deu certo traz sempre uma lista nova (a hora é lida de novo). */
  private publicar(): void {
    const nova = this.montar();
    const igual =
      nova.aba === this.v.aba &&
      nova.lista === this.v.lista &&
      nova.conectado === this.v.conectado &&
      nova.copiado === this.v.copiado;
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
    this.falhou = false;
    this.semReunioes = false;
    this.publicar();
  }
}
