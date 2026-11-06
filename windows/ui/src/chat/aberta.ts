// A conversa aberta (Task 6): uma abertura, do abrir ao fechar. O cliente faz uma a cada abrir e solta a de antes (e a
// da pessoa de antes, na troca): depois do soltar, nada do que chega dela pinta, as esperas dela acabam, a faixa dela
// sai e nenhum pedido sai mais por ela.
// - As páginas: as 50 mais novas, as anteriores de 50 em 50 (o alto da lista apareceu) e, a cada `conectou`, a volta
//   (as de depois da última que ela tem sem buraco, até o temMais dar false). As mensagens ficam em ordem de id, e um
//   id repetido não entra. Enquanto uma página de 50 (a primeira ou uma anterior) está a caminho, o log fica
//   `aria-busy`.
// - Os erros delas: sem rede ou um 500, a faixa (enquanto um pedido dela espera) e outra tentativa depois da espera da
//   vez; um 404 (a conversa não é mais minha) relê a lista, que a tira, e desiste; um 401 é o `fora`.
// - A leitura: com a janela na frente, o marcarLida até a mais nova (um id uma vez só).
import { ehChave, ErroChat, type ApiChat } from './api';
import type { Mensagem } from './tipos';

/** O que a abertura usa do cliente. As funções são da pessoa da vez dela (as que mudam algo conferem a vez). */
export interface ContextoDaAberta {
  api: ApiChat;
  /** A pessoa da vez ainda é a desta abertura. */
  daVez(): boolean;
  eventosNoAr(): boolean;
  /** Sobe a cada `conectou`: quem leu enquanto isso sabe que pode ter ficado um buraco. */
  conexao(): number;
  /** A janela principal está na frente. */
  frente(): boolean;
  /** Até onde cada conversa já foi lida (mandada daqui ou lida em outro computador meu): o mesmo id nunca vai de novo. */
  lidas: Map<number, number>;
  /** A vista desta abertura mudou (as mensagens, o temMaisAntigas, o carregando ou a faixa). */
  publicar(): void;
  /** O pedido com o 429 `limite`: a espera dele é desta abertura (acaba no soltar), e depois dela o pedido não sai. */
  comLimite<T>(pedir: () => Promise<T>): Promise<T>;
  /**
   * O erro de um pedido que se tenta até dar certo: um 401 é o `fora`; o resto chama o `falhou` (a faixa) e espera a
   * vez, na espera desta abertura. true: tente de novo.
   */
  esperarDepoisDoErro(e: unknown, tentativa: number, falhou: () => void): Promise<boolean>;
  /** Relê a lista de conversas (no 404, a conversa sai dela). */
  reler(): void;
  /** As mensagens que entraram: os meus Pendentes que viraram uma delas saem. */
  chegaram(mensagens: Mensagem[]): void;
  sairDoChat(): void;
}

/** O que a vista mostra da abertura. */
export interface VistaDaAberta {
  /** Em ordem de id. */
  mensagens: Mensagem[];
  temMaisAntigas: boolean;
  /** Uma página de 50 a caminho (a primeira ou uma anterior): o log fica `aria-busy`. */
  carregando: boolean;
}

/** As mensagens com as novas, em ordem de id: um id que já está não entra de novo (a mesma lista, se nada entrou). */
function juntarPorId(lista: Mensagem[], novas: Mensagem[]): Mensagem[] {
  const ids = new Set(lista.map((m) => m.id));
  const entram = novas.filter((m) => !ids.has(m.id) && ids.add(m.id));
  return entram.length === 0 ? lista : [...lista, ...entram].sort((x, y) => x.id - y.id);
}

/** O id da última de uma lista em ordem de id (a página do servidor vem da mais antiga para a mais nova). */
const ultimoId = (lista: Mensagem[]): number | null => lista.at(-1)?.id ?? null;

export class Aberta {
  readonly id: number;
  private readonly ctx: ContextoDaAberta;
  private v: VistaDaAberta = { mensagens: [], temMaisAntigas: false, carregando: true };
  /** A primeira página chegou. */
  private carregada = false;
  /**
   * Até esta mensagem, a aberta tem todas, sem buraco: a volta da conexão busca as de depois dela. null: nenhuma (a
   * primeira página veio vazia, e a volta lê as mais novas).
   */
  private ate: number | null = null;
  /** Os eventos estão no ar desde que o `ate` fechou sem buraco: cada mensagem que chega por eles o avança. */
  private continuo = false;
  private buscandoDepois = false;
  private buscandoAnteriores = false;
  /** Os pedidos dela que falharam e esperam outra tentativa (a faixa, enquanto houver um). */
  private falhas = 0;
  private solta = false;
  /** As esperas dela em curso (o soltar acorda todas). */
  private readonly acordar = new Set<() => void>();

  constructor(id: number, ctx: ContextoDaAberta) {
    this.id = id;
    this.ctx = ctx;
  }

  vista(): VistaDaAberta {
    return this.v;
  }

  /** Ainda aberta: o que chega para ela pinta, e as esperas dela continuam. */
  ativa(): boolean {
    return !this.solta;
  }

  /** Um pedido dela espera outra tentativa depois de um erro: a faixa. */
  falhando(): boolean {
    return !this.solta && this.falhas > 0;
  }

  /** As 50 mais novas, até dar certo (ou a conversa fechar), e a leitura. */
  async abrir(): Promise<void> {
    const noArAntes = this.ctx.eventosNoAr();
    const conexao = this.ctx.conexao();
    const r = await this.ateDarCerto(() => this.ctx.api.mensagens(this.id, {}));
    if (!r) return;
    this.carregada = true;
    // Com os eventos no ar do começo ao fim, o que veio depois da página chegou por eles; senão, a volta busca o que
    // pode ter ficado entre a página e eles (já, ou no próximo `conectou`).
    this.continuo = noArAntes && this.ctx.eventosNoAr() && this.ctx.conexao() === conexao;
    this.juntar(r.mensagens, { temMaisAntigas: r.temMais, carregou: true });
    this.ate = ultimoId(this.continuo ? this.v.mensagens : r.mensagens);
    this.ler();
    if (!this.continuo && this.ctx.eventosNoAr()) void this.buscarDepois();
  }

  /** As 50 anteriores à mais antiga da tela (o alto da lista apareceu): uma página de cada vez, até dar certo. */
  async anteriores(): Promise<void> {
    if (this.solta || !this.carregada || !this.v.temMaisAntigas || this.v.mensagens.length === 0 || this.buscandoAnteriores) return;
    this.buscandoAnteriores = true;
    this.mudar({ carregando: true });
    try {
      const r = await this.ateDarCerto(() => this.ctx.api.mensagens(this.id, { antes: this.v.mensagens[0].id }));
      if (r) this.juntar(r.mensagens, { temMaisAntigas: r.temMais, carregou: true });
    } finally {
      this.buscandoAnteriores = false;
      // Sem a página (o 404, o `fora`): o log não espera mais por ela.
      if (this.v.carregando && !this.solta) this.mudar({ carregando: false });
    }
  }

  /** Os eventos voltaram: a volta busca o que pode ter ficado de fora. */
  conectou(): void {
    void this.buscarDepois();
  }

  /** Os eventos caíram: sem eles, a aberta pode perder uma mensagem, e o `ate` para até a volta. */
  caiu(): void {
    this.continuo = false;
  }

  /** Uma mensagem desta conversa: pelos eventos (ela avança o `ate` e é lida) ou pela resposta de um envio meu. */
  chegou(m: Mensagem, pelosEventos: boolean): void {
    if (this.solta) return;
    this.juntar([m]);
    if (!pelosEventos) return;
    if (this.continuo) this.ate = Math.max(this.ate ?? m.id, m.id);
    this.ler();
  }

  /**
   * A leitura, com a janela na frente (a abertura, a mensagem que chega, o `frente` que vira true): o marcarLida até a
   * mais nova. Um id nunca vai duas vezes; a leitura que não chegou ao servidor fica para a próxima vez.
   */
  ler(): void {
    const ate = ultimoId(this.v.mensagens);
    if (this.solta || !this.ctx.frente() || ate === null) return;
    const { lidas } = this.ctx;
    const antes = lidas.get(this.id) ?? 0;
    if (ate <= antes) return;
    lidas.set(this.id, ate);
    this.ctx.api.marcarLida(this.id, ate).catch((e) => {
      if (!this.ctx.daVez()) return;
      if (ehChave(e)) this.ctx.sairDoChat();
      else if (lidas.get(this.id) === ate) lidas.set(this.id, antes);
    });
  }

  /** Fecha: as esperas dela acabam (e o pedido que esperava não sai), a faixa dela sai, e nada mais dela pinta. */
  soltar(): void {
    this.solta = true;
    for (const acordar of [...this.acordar]) acordar();
  }

  /** Espera `ms`, ou até o soltar (quem esperava confere o `ativa`). */
  dormir(ms: number): Promise<void> {
    if (this.solta) return Promise.resolve();
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

  /**
   * A volta da conexão (a cada `conectou`, ou depois de uma primeira página que pode ter deixado um buraco): as
   * mensagens de depois do `ate`, até o temMais dar false. Uma de cada vez: se os eventos religam enquanto ela lê, ela
   * lê de novo no fim. As que chegam pelos eventos no meio dela não avançam o `ate` (pode haver um buraco antes).
   */
  private async buscarDepois(): Promise<void> {
    if (this.solta || !this.carregada || this.buscandoDepois) return;
    this.buscandoDepois = true;
    try {
      for (;;) {
        const conexao = this.ctx.conexao();
        if (!(await this.lerDepois())) return;
        if (this.ctx.conexao() !== conexao) continue;
        // Sem buraco até a mais nova, com os eventos no ar desde antes da última página: eles avançam o `ate` de novo.
        this.continuo = this.ctx.eventosNoAr();
        if (this.continuo) this.ate = ultimoId(this.v.mensagens);
        this.ler();
        return;
      }
    } finally {
      this.buscandoDepois = false;
    }
  }

  /** As páginas de uma volta, do `ate` até o temMais dar false (sem o `ate`, as mais novas). false: desista. */
  private async lerDepois(): Promise<boolean> {
    for (;;) {
      const depois = this.ate;
      const r = await this.ateDarCerto(() => this.ctx.api.mensagens(this.id, depois === null ? {} : { depois }));
      if (!r) return false;
      // Sem o `ate` (a aberta estava vazia): as mais novas, e as anteriores a elas vêm pelo alto da lista.
      this.juntar(r.mensagens, depois === null ? { temMaisAntigas: r.temMais } : {});
      this.ate = ultimoId(r.mensagens) ?? depois;
      if (depois === null || !r.temMais) return true;
    }
  }

  /**
   * Um pedido desta abertura, até dar certo. Sem rede ou com um 500, a faixa enquanto ele espera, e outra tentativa
   * depois da espera da vez; um 404 (a conversa não é mais minha) relê a lista, que a tira; um 401 é o `fora`. null:
   * desista (o erro não passa, ou a conversa fechou e o que chegar não pinta).
   */
  private async ateDarCerto<T>(pedir: () => Promise<T>): Promise<T | null> {
    let falhou = false;
    const falhar = () => {
      if (falhou) return;
      falhou = true;
      this.falhas += 1;
      this.publicar();
    };
    try {
      for (let tentativa = 0; ; tentativa++) {
        try {
          const r = await this.ctx.comLimite(pedir);
          return this.solta ? null : r;
        } catch (e) {
          if (this.solta) return null;
          if (e instanceof ErroChat && e.status === 404) {
            this.ctx.reler();
            return null;
          }
          if (!(await this.ctx.esperarDepoisDoErro(e, tentativa, falhar))) return null;
        }
      }
    } finally {
      if (falhou) {
        this.falhas -= 1;
        this.publicar();
      }
    }
  }

  /**
   * As mensagens nesta conversa, em ordem de id (um id que já está não entra), e os meus Pendentes que viraram uma delas
   * saem. `temMaisAntigas`: o da página que chegou; `carregou`: a página de 50 entrou (o log deixa o aria-busy).
   */
  private juntar(novas: Mensagem[], o: { temMaisAntigas?: boolean; carregou?: boolean } = {}): void {
    const v = this.v;
    const mensagens = juntarPorId(v.mensagens, novas);
    const temMaisAntigas = o.temMaisAntigas ?? v.temMaisAntigas;
    const carregando = o.carregou ? false : v.carregando;
    if (mensagens !== v.mensagens || temMaisAntigas !== v.temMaisAntigas || carregando !== v.carregando) {
      this.v = { mensagens, temMaisAntigas, carregando };
    }
    this.ctx.chegaram(novas);
    this.publicar();
  }

  private mudar(parte: Partial<VistaDaAberta>): void {
    this.v = { ...this.v, ...parte };
    this.publicar();
  }

  private publicar(): void {
    if (!this.solta) this.ctx.publicar();
  }
}
