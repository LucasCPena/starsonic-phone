// O navegador de cada pessoa do teste: um Chromium com a câmera e o microfone falsos dela (midia.ts). O Navegador abre
// o cliente mínimo (cliente/cliente.js), que entra pela página do chat e liga ao servidor de vídeo; a Pagina abre a
// página da reunião de verdade (o /r/<código> do chat). Os dois leem o vídeo e o som que chegam do FreeSWITCH: a cor
// em pontos do mosaico e a frequência mais forte do som.
import {
  chromium,
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
  type WebSocket as WebSocketDaPagina,
  type WebSocketRoute,
} from '@playwright/test';
import {
  argumentosDoChromium,
  combinam,
  fundo,
  FUNDO_DO_MOSAICO_2,
  MOSAICO_2,
  type Cor,
  type Pessoa,
  type Ponto,
} from './midia';
import { repetirAte } from './espera';
import { anotarSegredos, CHAT, PAGINA, segredosUsados } from './servidores';

/** O Acesso de quem entra (seção 9 do protocolo); sem a senha, a ligação vai sem o X-Starsonic-Senha. */
export interface AcessoDoNavegador {
  senha?: string;
  video: { wss: string; uri: string };
}

/** Como uma ligação terminou: o código SIP da resposta final (um 403), ou null quando terminou por um BYE. */
export interface Fim {
  codigo: number | null;
  causa: string;
  originador: string;
}

export interface Mensagem {
  tipo: string;
  [campo: string]: any;
}

/** O cliente mínimo, como o cliente.js o põe em window.cliente. */
interface Cliente {
  diagnostico(): unknown;
  estatisticas(): Promise<unknown>;
  entrarPelaPagina(opcoes: { chat: string; codigo: string; nome: string }): Promise<{ bilhete: string }>;
  ligar(acesso: AcessoDoNavegador): Promise<void>;
  mensagens(): Mensagem[];
  amostra(fx: number, fy: number): Cor | null;
  frequencia(): { hz: number; db: number } | null;
  pedirTela(): Promise<string>;
  compartilhar(senha: string): Promise<void>;
  telaNoAr(): boolean;
  pararDeCompartilhar(): Promise<void>;
  pararDeMandar(): void;
  sair(): Promise<void>;
  terminou(prazo: number): Promise<Fim | null>;
  telaTerminou(prazo: number): Promise<Fim | null>;
}

declare global {
  interface Window {
    cliente: Cliente;
  }
}

const texto = (x: unknown) => JSON.stringify(x);

/** O tamanho do vídeo recebido, em pontos: o do mosaico que o agente escolheu. 0 por 0 sem vídeo. */
export interface Tamanho {
  largura: number;
  altura: number;
}

/** No navegador: o tamanho do vídeo do elemento (o videoWidth e o videoHeight). */
function tamanhoDoVideo(id: string): Tamanho {
  const video = document.getElementById(id) as HTMLVideoElement | null;
  return { largura: video?.videoWidth ?? 0, altura: video?.videoHeight ?? 0 };
}

/** Espera o vídeo recebido com o tamanho, até prazo ms. Depois de uma troca de layout, a imagem do tamanho antigo
 * ainda chega por um instante: quem confere as cores espera o tamanho antes. */
async function esperarTamanhoDe(
  quem: string,
  tamanho: () => Promise<Tamanho>,
  diagnostico: () => Promise<string>,
  largura: number,
  altura: number,
  prazo: number,
): Promise<void> {
  await repetirAte(
    prazo,
    100,
    tamanho,
    (t) => t.largura === largura && t.altura === altura,
    async (t) =>
      `o vídeo de ${quem} não ficou com ${largura}×${altura} em ${prazo / 1000} s; o último: ${texto(t)}; ` +
      `${await diagnostico()}`,
  );
}

/** Um Chromium com a câmera e o microfone de uma pessoa, na página do cliente mínimo. */
export class Navegador {
  private fechado = false;
  private readonly console: string[] = [];

  private constructor(
    readonly pessoa: Pessoa,
    private readonly browser: Browser,
    readonly page: Page,
  ) {}

  static async abrir(p: Pessoa): Promise<Navegador> {
    const browser = await chromium.launch({ args: argumentosDoChromium(p) });
    try {
      // A permissão da câmera e do microfone dada à página, como a pessoa a dá. Sem ela, o Chromium esconde o IP
      // dos candidatos atrás de um nome mDNS (<uuid>.local), que o FreeSWITCH não resolve e descarta, e a
      // ligação não acha caminho (no teste não há TURN). Com ela, a coleta dos candidatos também acaba logo.
      const contexto = await browser.newContext({ permissions: ['camera', 'microphone'] });
      const page = await contexto.newPage();
      const n = new Navegador(p, browser, page);
      page.on('console', (m) => n.console.push(`[${m.type()}] ${m.text()}`));
      page.on('pageerror', (e) => n.console.push(`[pageerror] ${e.message}`));
      await page.goto(`${PAGINA}/`);
      await page.waitForFunction(() => window.cliente !== undefined);
      return n;
    } catch (e) {
      await browser.close();
      throw e;
    }
  }

  /** O abrir, o canal e o pedir; com o aceito, o cliente liga sozinho. O bilhete do abrir fica anotado. */
  async entrarPelaPagina(codigo: string, nome: string): Promise<void> {
    anotarSegredos({ codigo });
    anotarSegredos(await this.page.evaluate((o) => window.cliente.entrarPelaPagina(o), { chat: CHAT, codigo, nome }));
  }

  async ligar(acesso: AcessoDoNavegador): Promise<void> {
    anotarSegredos(acesso);
    await this.page.evaluate((a) => window.cliente.ligar(a), acesso);
  }

  async mensagens(): Promise<Mensagem[]> {
    const lista = await this.page.evaluate(() => window.cliente.mensagens());
    anotarSegredos(lista);
    return lista;
  }

  /** A primeira mensagem do tipo no canal da página, esperando até prazo ms. */
  async esperarMensagem(tipo: string, prazo = 20_000): Promise<Mensagem> {
    const lista = await repetirAte(
      prazo,
      200,
      () => this.mensagens(),
      (l) => l.some((x) => x.tipo === tipo),
      (l) => `${this.pessoa.letra} não recebeu ${tipo} em ${prazo / 1000} s; recebeu ${texto(l.map((x) => x.tipo))}`,
    );
    return lista.find((x) => x.tipo === tipo) as Mensagem;
  }

  /** A cor de cada ponto do vídeo recebido, ou null sem vídeo. */
  amostras(pontos: readonly Ponto[]): Promise<Array<Cor | null>> {
    return this.page.evaluate((ps) => ps.map(([x, y]) => window.cliente.amostra(x, y)), pontos);
  }

  /** O estado das ligações e do vídeo do cliente, com os contadores do RTP e do ICE, para as mensagens de erro. */
  private async diagnostico(): Promise<string> {
    try {
      return texto(
        await this.page.evaluate(async () => ({
          estado: window.cliente.diagnostico(),
          midia: await window.cliente.estatisticas(),
        })),
      );
    } catch (e) {
      return `(sem diagnóstico: ${(e as Error).message})`;
    }
  }

  /** Espera cada cor num ponto diferente do vídeo recebido, em qualquer ordem, até prazo ms. */
  async esperarCores(pontos: readonly Ponto[], cores: readonly Cor[], prazo = 20_000): Promise<void> {
    await repetirAte(
      prazo,
      250,
      () => this.amostras(pontos),
      (vistas) => combinam(vistas, cores),
      async (vistas) =>
        `no vídeo de ${this.pessoa.letra}, as cores ${texto(cores)} não apareceram nos pontos ${texto(pontos)} ` +
        `em ${prazo / 1000} s; as últimas vistas: ${texto(vistas)}; o cliente: ${await this.diagnostico()}`,
    );
  }

  /** Espera o mosaico de 2: as duas cores nas células de cima e o fundo na linha de baixo, sem ninguém (nem o quadro
   * de quem está sem câmera: a célula de quem saiu fica vazia). */
  async esperarMosaicoDe2(cores: readonly Cor[], prazo = 20_000): Promise<void> {
    await repetirAte(
      prazo,
      250,
      () => this.amostras([...MOSAICO_2, ...FUNDO_DO_MOSAICO_2]),
      (vistas) => combinam(vistas.slice(0, 2), cores) && vistas.slice(2).every(fundo),
      async (vistas) =>
        `o vídeo de ${this.pessoa.letra} não voltou ao mosaico de 2 com ${texto(cores)} em ${prazo / 1000} s; ` +
        `as últimas vistas (os dois quadros e o fundo): ${texto(vistas)}; o cliente: ${await this.diagnostico()}`,
    );
  }

  /** O tamanho do vídeo recebido. */
  tamanho(): Promise<Tamanho> {
    return this.page.evaluate(tamanhoDoVideo, 'video');
  }

  /** Espera o vídeo recebido com o tamanho, até prazo ms. */
  async esperarTamanho(largura: number, altura: number, prazo = 20_000): Promise<void> {
    await esperarTamanhoDe(
      this.pessoa.letra,
      () => this.tamanho(),
      async () => `o cliente: ${await this.diagnostico()}`,
      largura,
      altura,
      prazo,
    );
  }

  /** Espera a frequência mais forte do som recebido a até 25 Hz de hz. */
  async esperarFrequencia(hz: number, prazo = 20_000): Promise<void> {
    await repetirAte(
      prazo,
      250,
      () => this.page.evaluate(() => window.cliente.frequencia()),
      (f) => f !== null && f.db > -80 && Math.abs(f.hz - hz) <= 25,
      async (f) => `${this.pessoa.letra} não ouviu ${hz} Hz em ${prazo / 1000} s; o último: ${texto(f)}; o cliente: ${await this.diagnostico()}`,
    );
  }

  /** A senha da tela compartilhada, pedida pelo canal da página. */
  async pedirTela(): Promise<string> {
    const senha = await this.page.evaluate(() => window.cliente.pedirTela());
    anotarSegredos({ senha });
    return senha;
  }

  async compartilhar(senha: string): Promise<void> {
    await this.page.evaluate((s) => window.cliente.compartilhar(s), senha);
  }

  telaNoAr(): Promise<boolean> {
    return this.page.evaluate(() => window.cliente.telaNoAr());
  }

  async pararDeCompartilhar(): Promise<void> {
    await this.page.evaluate(() => window.cliente.pararDeCompartilhar());
  }

  /** Nada mais sai da ligação da câmera (a RTCPeerConnection fecha sem o BYE), com o WebSocket aberto. */
  async pararDeMandar(): Promise<void> {
    await this.page.evaluate(() => window.cliente.pararDeMandar());
  }

  async sair(): Promise<void> {
    await this.page.evaluate(() => window.cliente.sair());
  }

  /** Como a ligação da câmera terminou, esperando até prazo ms; null se ela não terminou. */
  terminou(prazo = 10_000): Promise<Fim | null> {
    return this.page.evaluate((p) => window.cliente.terminou(p), prazo);
  }

  /** Como a última ligação da tela terminou, esperando até prazo ms; null se ela não terminou, ou nem saiu. */
  telaTerminou(prazo = 10_000): Promise<Fim | null> {
    return this.page.evaluate((p) => window.cliente.telaTerminou(p), prazo);
  }

  /** Sai da reunião (o BYE das ligações) e fecha o navegador: uma ligação esquecida no FreeSWITCH mandaria a mídia
   * para uma porta que o navegador do teste seguinte pode pegar. Pode ser chamado de novo. */
  async fechar(): Promise<void> {
    if (this.fechado) return;
    try {
      await this.sair();
    } catch {
      // a página já não responde
    }
    await this.fecharAba();
  }

  /** Fecha o navegador inteiro (o browser.close()), sem o sair() e sem o BYE, como quem fecha a aba. */
  async fecharAba(): Promise<void> {
    if (this.fechado) return;
    this.fechado = true;
    try {
      await this.mensagens();
    } catch {
      // a página já não responde: o que ela tinha já foi anotado
    }
    await this.browser.close();
    try {
      await test.info().attach(`console-${this.pessoa.letra}`, { body: this.console.join('\n'), contentType: 'text/plain' });
    } catch {
      // fora de um teste
    }
  }
}

// --- A página da reunião --------------------------------------------------------------------------------------------

/** No navegador: o [r, g, b] médio de um quadradinho de 5×5 em volta de cada ponto (em frações) do #mosaico da página,
 * ou null sem vídeo. É o amostra do cliente mínimo, lido da página sem nada dela. */
function coresDoMosaico(pontos: ReadonlyArray<readonly [number, number]>): Array<[number, number, number] | null> {
  const video = document.getElementById('mosaico') as HTMLVideoElement | null;
  const w = video?.videoWidth ?? 0;
  const h = video?.videoHeight ?? 0;
  const quadro = document.createElement('canvas');
  const pincel = quadro.getContext('2d', { willReadFrequently: true });
  if (!video || !w || !h || !pincel) return pontos.map(() => null);
  quadro.width = w;
  quadro.height = h;
  pincel.drawImage(video, 0, 0, w, h);
  return pontos.map(([fx, fy]) => {
    const x = Math.min(w - 3, Math.max(2, Math.round(fx * w)));
    const y = Math.min(h - 3, Math.max(2, Math.round(fy * h)));
    const d = pincel.getImageData(x - 2, y - 2, 5, 5).data;
    const soma = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) {
      soma[0] += d[i];
      soma[1] += d[i + 1];
      soma[2] += d[i + 2];
    }
    const [r, g, b] = soma.map((c) => Math.round(c / (d.length / 4)));
    return [r, g, b];
  });
}

/** No navegador: a frequência mais forte (de 100 Hz para cima) do som que o #som da página toca, e o nível dela em dB,
 * ou null sem som. O analisador do teste fica na janela e segue a faixa de agora do #som (cada ligação traz a sua). */
function frequenciaDoSom(): { hz: number; db: number } | null {
  interface Analise {
    contexto: AudioContext;
    analisador: AnalyserNode;
    fonte?: MediaStreamAudioSourceNode;
    faixa?: MediaStreamTrack;
  }
  const w = window as unknown as { analiseDoTeste?: Analise };
  const som = document.getElementById('som') as HTMLAudioElement | null;
  const faixa = (som?.srcObject as MediaStream | null)?.getAudioTracks()[0];
  if (!faixa) return null;
  if (!w.analiseDoTeste) {
    const contexto = new AudioContext();
    const analisador = contexto.createAnalyser();
    analisador.fftSize = 8192;
    analisador.smoothingTimeConstant = 0.5;
    w.analiseDoTeste = { contexto, analisador };
  }
  const a = w.analiseDoTeste;
  if (a.faixa !== faixa) {
    a.fonte?.disconnect();
    a.fonte = a.contexto.createMediaStreamSource(new MediaStream([faixa]));
    a.fonte.connect(a.analisador);
    a.faixa = faixa;
  }
  const dados = new Float32Array(a.analisador.frequencyBinCount);
  a.analisador.getFloatFrequencyData(dados);
  const taxa = a.contexto.sampleRate;
  const inicio = Math.ceil((100 * a.analisador.fftSize) / taxa);
  let melhor = inicio;
  for (let i = inicio; i < dados.length; i++) {
    if (dados[i] > dados[melhor]) melhor = i;
  }
  return { hz: (melhor * taxa) / a.analisador.fftSize, db: Number.isFinite(dados[melhor]) ? dados[melhor] : -1000 };
}

/** Antes da página: guarda cada RTCPeerConnection que ela cria (para os contadores do RTP e o diagnóstico), cada faixa
 * de câmera que o navegador lhe dá e cada violação da CSP. A página não muda: o JsSIP cria as conexões como sempre. */
function instrumentar(): void {
  const w = window as unknown as {
    conexoesDoTeste: RTCPeerConnection[];
    violacoesDoTeste: string[];
    camerasDoTeste: MediaStreamTrack[];
  };
  w.conexoesDoTeste = [];
  w.violacoesDoTeste = [];
  w.camerasDoTeste = [];
  const Original = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Original {
    constructor(...args: unknown[]) {
      super(...(args as [RTCConfiguration])); // o JsSIP passa também as restrições antigas, como segundo argumento
      w.conexoesDoTeste.push(this);
    }
  };
  document.addEventListener('securitypolicyviolation', (e) => {
    w.violacoesDoTeste.push(`${e.violatedDirective} ${e.blockedURI}`);
  });
  const aparelhos = navigator.mediaDevices;
  if (!aparelhos?.getUserMedia) return;
  const pedir = aparelhos.getUserMedia.bind(aparelhos);
  aparelhos.getUserMedia = async (c?: MediaStreamConstraints) => {
    const fluxo = await pedir(c);
    w.camerasDoTeste.push(...fluxo.getVideoTracks());
    return fluxo;
  };
}

/** Antes da página: um navegador sem microfone, que recusa todo pedido do som, como um PC que não tem um. */
function semMicrofone(): void {
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
    if (c?.audio) throw new DOMException('o teste não tem microfone', 'NotFoundError');
    return original(c);
  };
}

/** No navegador: o estado de cada ligação da página e os pacotes do RTP de cada uma, o título da tela e o vídeo e o som
 * recebidos, para a mensagem de um teste que falha. Nada disso é segredo. */
async function diagnosticoDaPagina(): Promise<unknown> {
  const w = window as unknown as { conexoesDoTeste?: RTCPeerConnection[] };
  const titulo = [...document.querySelectorAll('h1, h2')].find((h) => !h.closest('[hidden]'))?.textContent ?? null;
  const mosaico = document.getElementById('mosaico') as HTMLVideoElement | null;
  const som = document.getElementById('som') as HTMLAudioElement | null;
  const ligacoes = await Promise.all(
    (w.conexoesDoTeste ?? []).map(async (pc) => {
      const r: Record<string, unknown> = {
        ice: pc.iceConnectionState,
        conexao: pc.connectionState,
        sinal: pc.signalingState,
      };
      if (pc.signalingState === 'closed') return r;
      (await pc.getStats()).forEach((s) => {
        if (s.type === 'outbound-rtp') r[`sai-${s.kind}`] = s.packetsSent;
        if (s.type === 'inbound-rtp') r[`chega-${s.kind}`] = s.packetsReceived;
      });
      return r;
    }),
  );
  return {
    titulo,
    mosaico: mosaico && { largura: mosaico.videoWidth, altura: mosaico.videoHeight, pronto: mosaico.readyState },
    som: (som?.srcObject as MediaStream | null)?.getAudioTracks().map((f) => f.readyState) ?? null,
    ligacoes,
  };
}

/** No navegador: os pacotes de som que a última ligação da página mandou (o outbound-rtp do som), ou 0. */
async function pacotesDeSomMandados(): Promise<number> {
  const pc = (window as unknown as { conexoesDoTeste?: RTCPeerConnection[] }).conexoesDoTeste?.at(-1);
  if (!pc || pc.signalingState === 'closed') return 0;
  let n = 0;
  (await pc.getStats()).forEach((s) => {
    if (s.type === 'outbound-rtp' && s.kind === 'audio') n += s.packetsSent ?? 0;
  });
  return n;
}

/**
 * As conexões de um tipo (o canal do chat, ou o WSS do vídeo) de uma página, ligadas ao servidor de verdade sem mexer
 * no que passa. O teste pode derrubar a última: a rede que cai para a página, com o servidor ainda vendo a conexão
 * aberta (o celular que troca do Wi-Fi para o 4G: o servidor só percebe depois).
 */
class Passagem {
  private ultima: { pagina: WebSocketRoute; caiu: boolean } | null = null;

  constructor(private readonly nome: string) {}

  ligar(pagina: WebSocketRoute): void {
    const servidor = pagina.connectToServer();
    const conexao = { pagina, caiu: false };
    // O fechamento da página vai ao servidor, menos o da rede que caiu.
    pagina.onClose((code, reason) => {
      if (!conexao.caiu) void servidor.close({ code, reason });
    });
    this.ultima = conexao;
  }

  async derrubar(): Promise<void> {
    const c = this.ultima;
    if (!c) throw new Error(`a página não abriu ${this.nome}`);
    c.caiu = true;
    await c.pagina.close({ code: 1006 });
  }
}

export interface OpcoesDaPagina {
  /** O celular: a tela de 390×844, com o toque. */
  celular?: boolean;
  /** Sem microfone: o navegador recusa todo pedido do som. */
  semMicrofone?: boolean;
  /** O canal e o WSS do vídeo passam pelas rotas do teste, que pode derrubá-los. */
  derrubavel?: boolean;
}

/** A página da reunião de verdade (o /r/<código> do chat) num Chromium com a câmera e o microfone de uma pessoa. Ela
 * guarda o que o canal da página recebe e manda, e as primeiras linhas das mensagens SIP que a página manda. */
export class Pagina {
  private fechado = false;
  private readonly console: string[] = [];
  private readonly recebidas: Mensagem[] = [];
  private readonly mandadas: Mensagem[] = [];
  private readonly sip: string[] = [];
  private readonly canal = new Passagem('o canal');
  private readonly video = new Passagem('o WSS do vídeo');

  private constructor(
    readonly pessoa: Pessoa,
    private readonly browser: Browser,
    readonly page: Page,
  ) {}

  static async abrir(p: Pessoa, opcoes: OpcoesDaPagina = {}): Promise<Pagina> {
    const browser = await chromium.launch({ args: argumentosDoChromium(p) });
    try {
      const tela = opcoes.celular
        ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
        : { viewport: { width: 1280, height: 800 } };
      // A permissão dada, como no Navegador: sem ela, o Chromium esconde os IPs dos candidatos.
      const contexto = await browser.newContext({
        ...tela,
        permissions: ['camera', 'microphone'],
        locale: 'pt-BR',
        timezoneId: 'America/Sao_Paulo',
      });
      const page = await contexto.newPage();
      const n = new Pagina(p, browser, page);
      page.on('console', (m) => n.console.push(`[${m.type()}] ${m.text()}`));
      page.on('pageerror', (e) => n.console.push(`[pageerror] ${e.message}`));
      page.on('websocket', (ws) => n.observar(ws));
      page.on('response', (r) => {
        if (new URL(r.url()).pathname.startsWith('/api/v1/pagina/reunioes/')) {
          r.json().then(anotarSegredos, () => {}); // o bilhete do abrir
        }
      });
      await page.addInitScript(instrumentar);
      if (opcoes.semMicrofone) await page.addInitScript(semMicrofone);
      if (opcoes.derrubavel) {
        await page.routeWebSocket(/\/api\/v1\/pagina\/canal\?/, (ws) => n.canal.ligar(ws));
        await page.routeWebSocket(/\/sip$/, (ws) => n.video.ligar(ws));
      }
      return n;
    } catch (e) {
      await browser.close();
      throw e;
    }
  }

  /** O canal guarda as mensagens (e anota os segredos delas); o WSS do vídeo, a primeira linha de cada mensagem SIP que
   * a página manda (o INVITE, o ACK, o BYE), sem o resto, que leva a senha. */
  private observar(ws: WebSocketDaPagina): void {
    const { pathname, searchParams } = new URL(ws.url());
    if (pathname === '/api/v1/pagina/canal') {
      anotarSegredos({ bilhete: searchParams.get('bilhete') ?? '' });
      const guardar = (lista: Mensagem[]) => ({ payload }: { payload: string | Buffer }) => {
        try {
          const m = JSON.parse(String(payload)) as Mensagem;
          anotarSegredos(m);
          lista.push(m);
        } catch {
          // não é uma mensagem da página
        }
      };
      ws.on('framereceived', guardar(this.recebidas));
      ws.on('framesent', guardar(this.mandadas));
    } else if (pathname === '/sip') {
      ws.on('framesent', ({ payload }) => this.sip.push(String(payload).split('\r\n', 1)[0]));
    }
  }

  /** Abre o link e pede para entrar com o nome; com a câmera desligada, ela é desligada na entrada, antes do pedido. */
  async entrar(codigo: string, nome: string, opcoes: { cameraDesligada?: boolean } = {}): Promise<void> {
    anotarSegredos({ codigo });
    await this.page.goto(`${CHAT}/r/${codigo}`);
    await this.page.getByLabel('Seu nome').fill(nome);
    if (opcoes.cameraDesligada) {
      await this.botao('Câmera').click();
      await expect(this.botao('Câmera')).toHaveAttribute('aria-pressed', 'false');
    }
    await this.botao('Pedir para entrar').click();
  }

  titulo(texto: string): Locator {
    return this.page.getByRole('heading', { level: 1, name: texto, exact: true });
  }

  botao(texto: string): Locator {
    return this.page.getByRole('button', { name: texto, exact: true });
  }

  /** Os controles da reunião: aparecem com a ligação no ar. */
  controles(): Locator {
    return this.page.getByRole('navigation', { name: 'Controles da reunião' });
  }

  /** O aviso da conexão caída, por cima do mosaico. */
  caiu(): Locator {
    return this.page.getByRole('heading', { level: 2, name: 'A conexão caiu. Entrando de novo…', exact: true });
  }

  /** As mensagens que o canal da página recebeu, na ordem. */
  mensagensRecebidas(): Mensagem[] {
    return [...this.recebidas];
  }

  /** As mensagens que a página mandou pelo canal, na ordem. */
  mensagensMandadas(): Mensagem[] {
    return [...this.mandadas];
  }

  /** O participante do aceito. */
  participante(): string {
    const aceito = this.recebidas.find((m) => m.tipo === 'aceito');
    if (typeof aceito?.participante !== 'string') throw new Error(`${this.pessoa.letra} não recebeu o aceito`);
    return aceito.participante;
  }

  /** O canal da página cai (o servidor ainda o vê aberto). Só com o derrubavel. */
  derrubarOCanal(): Promise<void> {
    return this.canal.derrubar();
  }

  /** O WSS do vídeo da página cai (o agente ainda o vê aberto). Só com o derrubavel. */
  derrubarOVideo(): Promise<void> {
    return this.video.derrubar();
  }

  /** As faixas de câmera no fluxo da página (o das prévias, que a ligação também usa): todas, e as vivas. */
  camerasNoFluxo(): Promise<{ todas: number; vivas: number }> {
    return this.page
      .locator('video.previa')
      .first()
      .evaluate((v: HTMLVideoElement) => {
        const cameras = (v.srcObject as MediaStream | null)?.getVideoTracks() ?? [];
        return { todas: cameras.length, vivas: cameras.filter((t) => t.readyState === 'live').length };
      });
  }

  /** As faixas de câmera que o navegador deu à página e que ainda estão vivas (a luz acesa), no fluxo ou fora dele. */
  camerasVivas(): Promise<number> {
    return this.page.evaluate(() => {
      const w = window as unknown as { camerasDoTeste: MediaStreamTrack[] };
      return w.camerasDoTeste.filter((t) => t.readyState === 'live').length;
    });
  }

  /** O próximo pedido só da câmera (o da Câmera ligada de novo na reunião) fica segurado até o soltarACamera, com a
   * câmera já aberta: o pedido que ainda corre quando a conexão cai. */
  segurarACamera(): Promise<void> {
    return this.page.evaluate(() => {
      const w = window as unknown as { soltarCameraDoTeste?: () => void; cameraSeguradaDoTeste?: MediaStreamTrack };
      const aparelhos = navigator.mediaDevices;
      const original = aparelhos.getUserMedia.bind(aparelhos);
      aparelhos.getUserMedia = async (c?: MediaStreamConstraints) => {
        if (!c?.video || c.audio) return original(c);
        aparelhos.getUserMedia = original; // só o próximo
        const fluxo = await original(c);
        w.cameraSeguradaDoTeste = fluxo.getVideoTracks()[0];
        await new Promise<void>((soltar) => {
          w.soltarCameraDoTeste = soltar;
        });
        return fluxo;
      };
    });
  }

  /** Solta o pedido da câmera segurado, quando ele chegar. */
  async soltarACamera(): Promise<void> {
    const chegou = () => typeof (window as unknown as { soltarCameraDoTeste?: unknown }).soltarCameraDoTeste;
    await expect.poll(() => this.page.evaluate(chegou), { message: 'o pedido da câmera não chegou' }).toBe('function');
    await this.page.evaluate(() => (window as unknown as { soltarCameraDoTeste: () => void }).soltarCameraDoTeste());
  }

  /** O readyState da faixa do pedido segurado, ou null antes dele. */
  cameraSegurada(): Promise<string | null> {
    return this.page.evaluate(() => {
      const w = window as unknown as { cameraSeguradaDoTeste?: MediaStreamTrack };
      return w.cameraSeguradaDoTeste?.readyState ?? null;
    });
  }

  /** Os pacotes de som que a ligação de agora mandou. */
  pacotesDeSomMandados(): Promise<number> {
    return this.page.evaluate(pacotesDeSomMandados);
  }

  /** O aparelho acaba sozinho (desligado da USB, tomado por outro programa): a faixa dele, no fluxo da página, acaba,
   * e o navegador dispara o ended, que ele só dá para um fim que a página não causou. */
  acabarSozinha(tipo: 'audio' | 'video'): Promise<void> {
    return this.page
      .locator('video.previa')
      .first()
      .evaluate((v: HTMLVideoElement, tipo) => {
        const faixa = (v.srcObject as MediaStream).getTracks().find((f) => f.kind === tipo);
        if (!faixa) throw new Error(`o fluxo da página não tem a faixa ${tipo}`);
        faixa.stop();
        faixa.dispatchEvent(new Event('ended'));
      }, tipo);
  }

  private async diagnostico(): Promise<string> {
    try {
      return texto(await this.page.evaluate(diagnosticoDaPagina));
    } catch (e) {
      return `(sem diagnóstico: ${(e as Error).message})`;
    }
  }

  /** A cor de cada ponto do #mosaico, ou null sem vídeo. */
  amostras(pontos: readonly Ponto[]): Promise<Array<Cor | null>> {
    return this.page.evaluate(coresDoMosaico, pontos);
  }

  /** O tamanho do vídeo do #mosaico. */
  tamanho(): Promise<Tamanho> {
    return this.page.evaluate(tamanhoDoVideo, 'mosaico');
  }

  /** Espera o vídeo do #mosaico com o tamanho, até prazo ms. */
  async esperarTamanho(largura: number, altura: number, prazo = 20_000): Promise<void> {
    await esperarTamanhoDe(
      this.pessoa.letra,
      () => this.tamanho(),
      async () => `a página: ${await this.diagnostico()}`,
      largura,
      altura,
      prazo,
    );
  }

  /** Espera cada cor num ponto diferente do #mosaico, em qualquer ordem, até prazo ms. */
  async esperarCores(pontos: readonly Ponto[], cores: readonly Cor[], prazo = 20_000): Promise<Array<Cor | null>> {
    return repetirAte(
      prazo,
      250,
      () => this.amostras(pontos),
      (vistas) => combinam(vistas, cores),
      async (vistas) =>
        `no #mosaico de ${this.pessoa.letra}, as cores ${texto(cores)} não apareceram nos pontos ${texto(pontos)} ` +
        `em ${prazo / 1000} s; as últimas vistas: ${texto(vistas)}; a página: ${await this.diagnostico()}`,
    );
  }

  /** Espera a frequência mais forte do #som a até 25 Hz de hz. */
  async esperarFrequencia(hz: number, prazo = 20_000): Promise<void> {
    await repetirAte(
      prazo,
      250,
      () => this.page.evaluate(frequenciaDoSom),
      (f) => f !== null && f.db > -80 && Math.abs(f.hz - hz) <= 25,
      async (f) =>
        `o #som de ${this.pessoa.letra} não tocou ${hz} Hz em ${prazo / 1000} s; o último: ${texto(f)}; ` +
        `a página: ${await this.diagnostico()}`,
    );
  }

  /** O console da página não tem segredo nenhum nem erro, e nenhuma violação da CSP aconteceu (o WSS do vídeo, por
   * exemplo). Uma linha com segredo é só contada: o relatório do CI é público. */
  async conferirOConsole(): Promise<void> {
    const violacoes = await this.page.evaluate(
      () => (window as unknown as { violacoesDoTeste: string[] }).violacoesDoTeste,
    );
    expect(violacoes, `as violações da CSP na página de ${this.pessoa.letra}`).toEqual([]);
    const segredos = Object.values(segredosUsados()).flat();
    const comSegredo = this.console.filter((l) => segredos.some((s) => l.includes(s))).length;
    expect(comSegredo, `as linhas do console de ${this.pessoa.letra} com um segredo`).toBe(0);
    const erros = this.console.filter((l) => /^\[(error|pageerror)\]/.test(l) || /Content.Security.Policy/i.test(l));
    expect(erros, `os erros no console de ${this.pessoa.letra}`).toEqual([]);
  }

  /** Sai da reunião, se estiver nela (o BYE da ligação sai antes de o navegador fechar), e fecha o navegador. Pode ser
   * chamado de novo. */
  async fechar(): Promise<void> {
    if (this.fechado) return;
    this.fechado = true;
    try {
      const sair = this.controles().getByRole('button', { name: 'Sair', exact: true });
      if (await sair.isVisible()) {
        const byes = () => this.sip.filter((l) => l.startsWith('BYE ')).length;
        const antes = byes();
        await sair.click();
        await repetirAte(5_000, 100, byes, (n) => n > antes, () => 'sem o BYE').catch(() => {});
      }
    } catch {
      // a página já não responde
    }
    await this.browser.close();
    const segredos = Object.values(segredosUsados()).flat();
    const limpo = this.console.map((l) => segredos.reduce((linha, s) => linha.replaceAll(s, '***'), l));
    try {
      const anexo = { body: limpo.join('\n'), contentType: 'text/plain' };
      await test.info().attach(`console-pagina-${this.pessoa.letra}`, anexo);
    } catch {
      // fora de um teste
    }
  }
}
