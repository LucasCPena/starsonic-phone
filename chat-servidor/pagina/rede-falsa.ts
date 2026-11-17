// A rede falsa da página (docs/chat-protocolo.md, seção 10): o abrir respondido pelo page.route, e o canal e o WSS do
// vídeo pelo page.routeWebSocket, sem passar pelo chat nem por um servidor de vídeo. Cada teste diz o que o abrir
// responde e o que o canal manda; os pedidos, as mensagens da página e as mensagens SIP dela ficam guardados para
// conferir.
import { expect, type Page, type Route, type WebSocketRoute } from '@playwright/test';

/** O código do link nos testes (qualquer um serve: a rota devolve a mesma página). */
export const CODIGO = 'k7q49xwpht';

export interface Reuniao {
  tipo: 'marcada' | 'naHora' | 'teste';
  assunto: string | null;
  inicio: number | null;
}

/**
 * Uma resposta do abrir: o status e o corpo em JSON; nenhuma (o pedido fica sem resposta); ou a segurada, o 200 que só
 * sai no soltarAbrires.
 */
export type RespostaDoAbrir = { status: number; corpo: unknown } | 'semResposta' | 'segurada';

export type Mensagem = { tipo: string; [campo: string]: unknown };

/** Um canal que a página abriu, visto do lado do servidor. */
export class Canal {
  /** As mensagens que a página mandou, na ordem. */
  readonly recebidas: Mensagem[] = [];
  /** O código com que a página fechou o canal (null sem código), ou undefined enquanto ela não o fecha. */
  fechadoPelaPagina: number | null | undefined = undefined;
  private soltar: (() => void) | null = null;

  constructor(
    private readonly ws: WebSocketRoute,
    readonly bilhete: string,
  ) {}

  /** O canal fica conectando até o abrir. */
  segurar(): Promise<void> {
    return new Promise((r) => {
      this.soltar = r;
    });
  }

  /** O canal que ficou conectando (com o canaisAbrem falso) abre agora. */
  abrir(): void {
    this.soltar?.();
  }

  /** Uma mensagem do servidor para a página. */
  mandar(m: Mensagem): void {
    this.ws.send(JSON.stringify(m));
  }

  /** O servidor fecha o canal com o código (1000, 1011…). */
  fechar(codigo: number): Promise<void> {
    return this.ws.close({ code: codigo });
  }

  tipos(): string[] {
    return this.recebidas.map((m) => m.tipo);
  }
}

/** Um WSS do vídeo que a página abriu (o do JsSIP), visto do lado do servidor, que só responde o que o teste manda. */
export class VideoFalso {
  /** As mensagens SIP que a página mandou, na ordem. */
  readonly recebidas: string[] = [];

  constructor(
    private readonly ws: WebSocketRoute,
    readonly url: string,
  ) {}

  /** O servidor fecha a conexão. */
  fechar(): Promise<void> {
    return this.ws.close();
  }

  /** Uma mensagem SIP do servidor para a página. */
  mandar(mensagem: string): void {
    this.ws.send(mensagem);
  }

  /** A primeira mensagem SIP da página com o método (INVITE, BYE…), quando ela chegar. */
  async mensagem(metodo: string): Promise<string> {
    const achar = () => this.recebidas.find((m) => m.startsWith(`${metodo} `));
    await expect.poll(() => achar() !== undefined, { message: `a página não mandou o ${metodo}` }).toBe(true);
    return achar() as string;
  }
}

export class RedeFalsa {
  /** Os caminhos dos abrir que chegaram, na ordem. */
  readonly abrires: string[] = [];
  readonly canais: Canal[] = [];
  readonly videos: VideoFalso[] = [];
  /** O que o servidor responde a cada pedir; sem ele, nada. */
  aoPedir: ((canal: Canal) => void) | null = null;
  /** Falso: os canais novos ficam conectando, até o abrir de cada um. */
  canaisAbrem = true;
  /** Falso: os WSS do vídeo ficam conectando, e a ligação não começa; verdadeiro: eles abrem, e o JsSIP manda o
   * INVITE, que fica sem resposta. */
  videosAbrem = false;
  private readonly fila: RespostaDoAbrir[] = [];
  private readonly segurados: Array<() => void> = [];

  private constructor(private readonly reuniao: Reuniao) {}

  /** Liga a rede falsa à página, antes de ela abrir. O WSS do vídeo é o do Acesso dos testes. */
  static async instalar(page: Page, reuniao: Reuniao): Promise<RedeFalsa> {
    const rede = new RedeFalsa(reuniao);
    await page.route('**/api/v1/pagina/reunioes/*', (route) => rede.abrir(route));
    await page.routeWebSocket(/\/api\/v1\/pagina\/canal\?/, (ws) => rede.canal(ws));
    await page.routeWebSocket(/^wss:\/\/video\.exemplo\.com\.br(:\d+)?\/sip$/, (ws) => rede.video(ws));
    return rede;
  }

  /** As próximas respostas do abrir, na ordem. Depois delas, o abrir dá o 200 com a reunião e um bilhete novo. */
  responder(...respostas: RespostaDoAbrir[]): void {
    this.fila.push(...respostas);
  }

  /** Os abrir segurados respondem agora, com o 200. */
  soltarAbrires(): void {
    for (const soltar of this.segurados.splice(0)) soltar();
  }

  /** O canal número n (do primeiro, 1), quando a página o abrir. */
  async canalNumero(n: number): Promise<Canal> {
    await expect
      .poll(() => this.canais.length, { message: `a página não abriu o canal ${n}` })
      .toBeGreaterThanOrEqual(n);
    return this.canais[n - 1];
  }

  /** O WSS do vídeo número n (do primeiro, 1), quando a página o abrir. */
  async videoNumero(n: number): Promise<VideoFalso> {
    await expect
      .poll(() => this.videos.length, { message: `a página não abriu o WSS do vídeo ${n}` })
      .toBeGreaterThanOrEqual(n);
    return this.videos[n - 1];
  }

  private async abrir(route: Route): Promise<void> {
    this.abrires.push(new URL(route.request().url()).pathname);
    const ok = { status: 200, corpo: { reuniao: this.reuniao, bilhete: `bilhete-${this.abrires.length}` } };
    let resposta = this.fila.shift() ?? ok;
    if (resposta === 'semResposta') return;
    if (resposta === 'segurada') {
      await new Promise<void>((r) => this.segurados.push(r));
      resposta = ok;
    }
    await route.fulfill({
      status: resposta.status,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(resposta.corpo),
    });
  }

  // O Playwright abre o canal da página quando este manipulador acaba: o que não acaba o deixa conectando.
  private async canal(ws: WebSocketRoute): Promise<void> {
    const canal = new Canal(ws, new URL(ws.url()).searchParams.get('bilhete') ?? '');
    this.canais.push(canal);
    ws.onMessage((texto) => {
      const m = JSON.parse(String(texto)) as Mensagem;
      canal.recebidas.push(m);
      if (m.tipo === 'pedir') this.aoPedir?.(canal);
    });
    ws.onClose((codigo) => {
      canal.fechadoPelaPagina = codigo ?? null;
    });
    if (!this.canaisAbrem) await canal.segurar();
  }

  // Como no canal: o WSS abre quando este manipulador acaba, e o que nunca acaba o deixa conectando.
  private async video(ws: WebSocketRoute): Promise<void> {
    const video = new VideoFalso(ws, ws.url());
    this.videos.push(video);
    ws.onMessage((m) => {
      video.recebidas.push(String(m));
    });
    if (!this.videosAbrem) await new Promise<void>(() => {});
  }
}
