// A reunião dentro da janela do app (o plano 3b): o controlador da vista, sem tela. O "Entrar" da lista pede o passe
// (o ReunioesCliente.pedirPasse) e, com ele, abre a vista: a fase `carregando`, o iframe da página da reunião
// (`<chat>/r/<código>`, sem o passe no endereço) e o tamanho grande da janela (o `videoWindow` `grande`).
// - A conversa com a página é por postMessage (docs/chat-protocolo.md, seção 10): objetos com `"starsonic": 1` e o
//   `tipo`. O app só aceita a mensagem que vem do `contentWindow` do iframe montado e da origem do chat; um `tipo`
//   desconhecido é ignorado. As do app vão com o `postMessage(m, <origem do chat>)`.
// - O passe pedido no Entrar é o primeiro a ir, no primeiro `pronta`; cada `pronta` seguinte (a página que entra de
//   novo sozinha, no meio da reunião) pede um passe novo e o manda, e nada mais muda na vista. Um passe que falha nesse
//   momento não vai: a página espera os 15 s dela. O passe só existe aqui entre a resposta e o `pronta` que o leva.
// - Sem o primeiro `pronta` em 15 s (PRONTA_MS) a fase é `naoAbriu`: no lugar do iframe, o Tentar de novo, o Fechar e o
//   Abrir no navegador (a Reuniao.tsx).
// - O `estado` da página muda a fase (`entrada`, `naReuniao`, `fora`) e o `microfone`. O `link` vai ao `reuniaoLink`
//   (só http e https, até 2.048 caracteres; o núcleo confere de novo).
// - Os `aparelhos` das Configurações vão no `passe` e, depois, a cada mudança deles.
// - As ligações de agora (o CallState) servem ao Entrar, que recusa com uma ligação (também tocando, ou a sala de vídeo
//   de pé) e com outra reunião na vista; a reunião que já está na vista só é mostrada.
// Nada da reunião (o código, o passe, o link, o assunto) vai ao console.
import type { Bridge } from '../bridge';
import type { CallState } from '../state';
import type { ReunioesCliente, ResultadoSemPasse } from './cliente';
import { DESLIGUE_PARA_ENTRAR, SAIA_PARA_ENTRAR_EM_OUTRA } from './textos';

export type FaseNoApp = 'nenhuma' | 'carregando' | 'naoAbriu' | 'entrada' | 'naReuniao' | 'fora';

export interface VistaNoApp {
  fase: FaseNoApp;
  /** A reunião da vista; null com a fase 'nenhuma'. O assunto é o da resposta do passe ('' sem assunto). */
  reuniao: { codigo: string; assunto: string } | null;
  /** O src do iframe (`<chat>/r/<código>`); null sem iframe. */
  endereco: string | null;
  /** Muda a cada abertura e a cada "Tentar de novo": a chave do iframe (um documento novo). */
  quadro: number;
  /** O microfone do último `estado` da página (false antes do primeiro). */
  microfone: boolean;
  /** O tamanho da janela da reunião. */
  janela: 'grande' | 'telaCheia';
}

/** Os nomes dos aparelhos das Configurações do app (`""` é o padrão do sistema). */
export interface Aparelhos {
  microfone: string;
  altoFalante: string;
  camera: string;
}

/** Sem o primeiro `pronta` neste tempo, a reunião não abriu. */
export const PRONTA_MS = 15_000;
/** Sem o `fim` neste tempo depois do `sair`, a vista fecha assim mesmo (a Task 7). */
export const SAIR_MS = 2_000;
/** O mais que o `reuniaoLink` aceita. */
const LINK_MAXIMO = 2048;

export type ResultadoDoEntrar = { ok: true } | ResultadoSemPasse;

const SEM_RESULTADO: ResultadoSemPasse = { ok: false, erro: null, outraEmpresa: false };
const FECHADA: Omit<VistaNoApp, 'quadro'> = {
  fase: 'nenhuma',
  reuniao: null,
  endereco: null,
  microfone: false,
  janela: 'grande',
};
const SEM_APARELHOS: Aparelhos = { microfone: '', altoFalante: '', camera: '' };
const FASES_DA_PAGINA: readonly FaseNoApp[] = ['entrada', 'naReuniao', 'fora'];

/** Os campos de uma mensagem da página, antes de a conferirmos. */
type Mensagem = { starsonic?: unknown; tipo?: unknown; fase?: unknown; microfone?: unknown; url?: unknown };

export class ReuniaoNoApp {
  private readonly reunioes: ReunioesCliente;
  private readonly bridge: Bridge;
  /** O endereço do chat, sem a barra do fim; a origem dele é o `targetOrigin` e a única que a página pode ter. */
  private readonly base: string;
  private readonly origem: string;
  private readonly ouvintes = new Set<() => void>();
  private v: VistaNoApp = { ...FECHADA, quadro: 0 };
  private elemento: HTMLIFrameElement | null = null;
  /** O passe do Entrar (ou do Tentar de novo), até o primeiro `pronta` que o leva. */
  private passe: string | null = null;
  /** O primeiro `pronta` deste documento já chegou. */
  private jaPronta = false;
  /** A página já recebeu um passe: os `aparelhos` trocados depois vão a ela. */
  private passeEnviado = false;
  private relogio: ReturnType<typeof setTimeout> | undefined;
  /** O pedido do passe do Entrar ou do Tentar de novo está no ar: outro igual não faz nada. */
  private pedindo = false;
  /** Sobe a cada abertura e a cada fechamento: o que volta de um pedido de antes não vale. */
  private abertura = 0;
  private ligacao: CallState | null = null;
  private aparelhosAgora: Aparelhos | null = null;

  constructor(o: { reunioes: ReunioesCliente; bridge: Bridge; base: string }) {
    this.reunioes = o.reunioes;
    this.bridge = o.bridge;
    this.base = o.base.replace(/\/+$/, '');
    this.origem = new URL(o.base).origin;
    window.addEventListener('message', (e) => this.aoReceber(e));
  }

  vista(): VistaNoApp {
    return this.v;
  }

  assinar(f: () => void): () => void {
    this.ouvintes.add(f);
    return () => this.ouvintes.delete(f);
  }

  /** O "Entrar": confere se pode, pede o passe e, com ele, abre a vista e pede o tamanho grande. */
  async entrar(codigo: string): Promise<ResultadoDoEntrar> {
    if (this.ligacao !== null) {
      this.reunioes.avisar(DESLIGUE_PARA_ENTRAR);
      return SEM_RESULTADO;
    }
    if (this.v.reuniao !== null) {
      if (this.v.reuniao.codigo === codigo) return { ok: true };
      this.reunioes.avisar(SAIA_PARA_ENTRAR_EM_OUTRA);
      return SEM_RESULTADO;
    }
    if (this.pedindo) return SEM_RESULTADO;
    this.pedindo = true;
    let r;
    try {
      r = await this.reunioes.pedirPasse(codigo);
    } finally {
      this.pedindo = false;
    }
    if (!r.ok) return r;
    // A ligação que chegou enquanto o passe vinha.
    if (this.ligacao !== null) {
      this.reunioes.avisar(DESLIGUE_PARA_ENTRAR);
      return SEM_RESULTADO;
    }
    if (this.v.reuniao !== null) return SEM_RESULTADO;
    this.passe = r.passe;
    this.abrir(codigo, r.reuniao.assunto ?? '');
    this.bridge.send({ cmd: 'videoWindow', modo: 'grande' });
    return { ok: true };
  }

  /** O iframe da vista entrou no documento (o elemento) ou saiu (null). */
  quadroMontado(el: HTMLIFrameElement | null): void {
    this.elemento = el;
  }

  /** "Tentar de novo": outro passe, um documento novo (o `quadro` novo) e os 15 s de novo. */
  async tentarDeNovo(): Promise<void> {
    const reuniao = this.v.reuniao;
    if (this.v.fase !== 'naoAbriu' || reuniao === null || this.pedindo) return;
    this.pedindo = true;
    const abertura = this.abertura;
    await this.reunioes.pedirPasse(reuniao.codigo).then((r) => {
      // Fechada no meio: o fechar já soltou o `pedindo`, e a resposta é de uma abertura que acabou.
      if (abertura !== this.abertura) return;
      this.pedindo = false;
      if (this.v.fase !== 'naoAbriu') return;
      if (!r.ok) {
        if (r.erro !== null) this.reunioes.avisar(r.erro);
        return;
      }
      this.passe = r.passe;
      this.abrir(reuniao.codigo, reuniao.assunto);
    });
  }

  /** O "Abrir no navegador" de "A reunião não abriu.": dando certo, a vista fecha; os erros vão ao aviso curto. */
  async abrirNoNavegador(): Promise<void> {
    const codigo = this.v.reuniao?.codigo;
    if (this.v.fase !== 'naoAbriu' || codigo === undefined) return;
    const abertura = this.abertura;
    const r = await this.reunioes.abrirNoNavegador(codigo);
    if (r.ok) {
      if (abertura === this.abertura) this.fechar();
    } else if (r.erro !== null) {
      this.reunioes.avisar(r.erro);
    }
  }

  /** Fecha a vista sem o `sair` (o "Fechar" de "A reunião não abriu."). A janela volta ao normal. */
  fechar(): void {
    if (this.v.fase === 'nenhuma') return;
    this.abertura += 1;
    this.pedindo = false;
    clearTimeout(this.relogio);
    this.relogio = undefined;
    this.passe = null;
    this.jaPronta = false;
    this.passeEnviado = false;
    this.mudar({ ...FECHADA });
    this.bridge.send({ cmd: 'videoWindow', modo: 'normal' });
  }

  telaCheia(ligada: boolean): void {
    if (this.v.fase === 'nenhuma') return;
    this.bridge.send({ cmd: 'videoWindow', modo: ligada ? 'telaCheia' : 'grande' });
    this.mudar({ janela: ligada ? 'telaCheia' : 'grande' });
  }

  /** Os aparelhos das Configurações, a cada estado do app: o `aparelhos` vai à página quando eles mudam. */
  aparelhos(a: Aparelhos): void {
    const antes = this.aparelhosAgora;
    this.aparelhosAgora = a;
    const igual = antes?.microfone === a.microfone && antes.altoFalante === a.altoFalante && antes.camera === a.camera;
    if (igual) return;
    if (this.passeEnviado) this.postar({ tipo: 'aparelhos', aparelhos: a });
  }

  /** As ligações de agora (o CallState): o "Entrar" usa para recusar; as Tasks 5 e 6 acrescentam o resto. */
  ligacoes(l: CallState | null): void {
    this.ligacao = l;
  }

  /** A vista abre (ou abre de novo): o documento novo, a fase `carregando` e os 15 s. */
  private abrir(codigo: string, assunto: string): void {
    this.abertura += 1;
    this.jaPronta = false;
    this.passeEnviado = false;
    this.mudar({
      fase: 'carregando',
      reuniao: { codigo, assunto },
      endereco: `${this.base}/r/${codigo}`,
      quadro: this.v.quadro + 1,
      microfone: false,
    });
    clearTimeout(this.relogio);
    this.relogio = setTimeout(() => this.semPronta(), PRONTA_MS);
  }

  private semPronta(): void {
    this.relogio = undefined;
    if (this.v.fase !== 'carregando' || this.jaPronta) return;
    this.passe = null;
    this.mudar({ fase: 'naoAbriu', endereco: null, microfone: false });
  }

  private aoReceber(e: MessageEvent): void {
    const el = this.elemento;
    if (el === null || e.source === null || e.source !== el.contentWindow || e.origin !== this.origem) return;
    const m = e.data as Mensagem | null;
    if (typeof m !== 'object' || m === null || m.starsonic !== 1) return;
    switch (m.tipo) {
      case 'pronta':
        this.aPaginaEstaPronta();
        break;
      case 'estado':
        this.oEstadoDaPagina(m);
        break;
      case 'link':
        if (typeof m.url === 'string' && m.url.length <= LINK_MAXIMO && ehHttp(m.url)) {
          this.bridge.send({ cmd: 'reuniaoLink', url: m.url });
        }
        break;
    }
  }

  private aPaginaEstaPronta(): void {
    if (this.v.reuniao === null) return;
    if (!this.jaPronta && this.passe !== null) {
      this.jaPronta = true;
      clearTimeout(this.relogio);
      this.relogio = undefined;
      const passe = this.passe;
      this.passe = null;
      this.passeEnviado = true;
      this.postar({ tipo: 'passe', passe, aparelhos: this.aparelhosAgora ?? SEM_APARELHOS });
      return;
    }
    this.jaPronta = true;
    // Um `pronta` depois do primeiro (a página entra de novo sozinha): um passe novo, e mais nada muda.
    const { codigo } = this.v.reuniao;
    const quadro = this.v.quadro;
    void this.reunioes.pedirPasse(codigo).then((r) => {
      if (!r.ok || this.v.quadro !== quadro || this.v.endereco === null) return;
      this.passeEnviado = true;
      this.postar({ tipo: 'passe', passe: r.passe, aparelhos: this.aparelhosAgora ?? SEM_APARELHOS });
    });
  }

  private oEstadoDaPagina(m: Mensagem): void {
    const fase = FASES_DA_PAGINA.find((f) => f === m.fase);
    if (fase === undefined || typeof m.microfone !== 'boolean' || this.v.endereco === null) return;
    this.mudar({ fase, microfone: m.microfone });
  }

  private postar(m: object): void {
    this.elemento?.contentWindow?.postMessage({ starsonic: 1, ...m }, this.origem);
  }

  /** Muda a vista e diz às telas, se algo mudou. */
  private mudar(parte: Partial<VistaNoApp>): void {
    const nova = { ...this.v, ...parte };
    const igual = (Object.keys(nova) as Array<keyof VistaNoApp>).every((k) =>
      k === 'reuniao'
        ? nova.reuniao?.codigo === this.v.reuniao?.codigo && nova.reuniao?.assunto === this.v.reuniao?.assunto
        : nova[k] === this.v[k],
    );
    if (igual) return;
    this.v = nova;
    for (const f of [...this.ouvintes]) f();
  }
}

/** O endereço tem o esquema http ou https. */
function ehHttp(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
