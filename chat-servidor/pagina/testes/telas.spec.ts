// As telas da página da reunião, no Chromium: a página de verdade, servida pelo chat no modo de teste, com a rede
// falsa (o abrir e o canal) e o relógio fixo. O relógio fica parado: os prazos da página só andam pelo runFor.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { CHAT } from '../chat';
import {
  AGORA,
  atenderOInvite,
  cabecalhoSip,
  contarOClique,
  direcoes,
  inviteDe,
  MARCADA,
  registrarConexoes,
} from '../ligacoes-falsas';
import { CODIGO, RedeFalsa, type Mensagem, type Reuniao, type RespostaDoAbrir, type VideoFalso } from '../rede-falsa';

/** O aceito, com um Acesso inventado (seção 10 do protocolo). */
const ACEITO: Mensagem = {
  tipo: 'aceito',
  participante: 'participante-1',
  senha: 'senha-1',
  turn: { urls: ['turns:turn.exemplo.com.br:5349'], usuario: 'usuario-1', senha: 'credencial-1' },
  video: { wss: 'wss://video.exemplo.com.br:7443/sip', uri: 'sip:reuniao@video.exemplo.com.br' },
  volta: 'volta-1',
};

const AVISO_DE_ACESSO = 'Sem acesso à câmera ou ao microfone: libere no navegador';
const TEXTO_DE_ACESSO =
  'Clique no cadeado ao lado do endereço da página, permita a câmera e o microfone, e depois em Tentar de novo. ' +
  'Você também pode entrar só para ver e ouvir.';
const SEM_CAMERA = 'Entrando assim, você vê e ouve a reunião, e o seu quadro mostra só o seu nome.';

interface Opcoes {
  reuniao?: Reuniao;
  /** As primeiras respostas do abrir; depois delas, o 200. */
  respostas?: RespostaDoAbrir[];
}

/** O relógio parado em AGORA e a rede falsa, antes de a página abrir (a regra do clock na 1.56.1). */
async function preparar(page: Page, opcoes: Opcoes = {}): Promise<RedeFalsa> {
  await page.clock.install({ time: AGORA - 1000 });
  await page.clock.pauseAt(AGORA);
  const rede = await RedeFalsa.instalar(page, opcoes.reuniao ?? MARCADA);
  rede.responder(...(opcoes.respostas ?? []));
  return rede;
}

/** Abre a página do link, com o relógio parado e a rede falsa. */
async function abrir(page: Page, opcoes: Opcoes = {}): Promise<RedeFalsa> {
  const rede = await preparar(page, opcoes);
  await page.goto(`/r/${CODIGO}`);
  return rede;
}

/** A câmera e o microfone chegaram: a imagem da entrada tem o fluxo deles. */
async function esperarAMidia(page: Page): Promise<void> {
  await expect
    .poll(() => page.locator('video.previa').first().evaluate((v: HTMLVideoElement) => v.srcObject !== null))
    .toBe(true);
}

async function pedirParaEntrar(page: Page, nome = 'Maria Lima'): Promise<void> {
  await page.getByLabel('Seu nome').fill(nome);
  await page.getByRole('button', { name: 'Pedir para entrar' }).click();
}

/**
 * O getUserMedia que falha com o erro: em todo pedido, ou só nos que levam o vídeo. Ele conta os pedidos, e para de
 * falhar quando o teste põe window.midiaLivre.
 */
async function midiaComErro(page: Page, erro: { tudo?: string; video?: string }): Promise<void> {
  await page.addInitScript((erro) => {
    const w = window as unknown as { pedidosDeMidia: number; midiaLivre?: boolean };
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    w.pedidosDeMidia = 0;
    navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
      w.pedidosDeMidia++;
      const nome = erro.tudo ?? (c?.video ? erro.video : undefined);
      if (nome && !w.midiaLivre) throw new DOMException('o erro do teste', nome);
      return original(c);
    };
  }, erro);
}

const pedidosDeMidia = (page: Page) =>
  page.evaluate(() => (window as unknown as { pedidosDeMidia: number }).pedidosDeMidia);

interface MidiaFalsa {
  /** O erro do pedido dos dois juntos. */
  juntos?: string;
  /** O erro dos pedidos que levam o som ou a imagem; o teste pode mudar depois, no window.erros. */
  erros?: { audio?: string; video?: string };
  /** O que a consulta das permissões dá, ou 'lanca': a consulta lança. */
  permissoes?: { microphone: PermissionState; camera: PermissionState } | 'lanca';
}

/**
 * A câmera e o microfone falsos do Chromium, com o registro de cada pedido (window.pedidos: 'audio+video', 'audio' ou
 * 'video', e as restrições dele, inteiras, em window.restricoesDeMidia) e de cada faixa de câmera que eles deram
 * (window.cameras), e os erros e as permissões do teste.
 */
async function midiaFalsa(page: Page, opcoes: MidiaFalsa): Promise<void> {
  await page.addInitScript((opcoes) => {
    const w = window as unknown as {
      pedidos: string[];
      restricoesDeMidia: unknown[];
      cameras: MediaStreamTrack[];
      erros: Record<string, string>;
    };
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    w.pedidos = [];
    w.restricoesDeMidia = [];
    w.cameras = [];
    w.erros = { ...opcoes.erros };
    navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
      w.pedidos.push([c?.audio && 'audio', c?.video && 'video'].filter(Boolean).join('+'));
      w.restricoesDeMidia.push(c);
      // Com o window.seguraCamera, o pedido só da câmera espera o window.soltarCamera().
      const s = window as unknown as { seguraCamera?: boolean; soltarCamera?: () => void };
      if (s.seguraCamera && c?.video && !c?.audio) {
        await new Promise<void>((r) => {
          s.soltarCamera = r;
        });
      }
      if (c?.audio && c?.video && opcoes.juntos) throw new DOMException('o erro do teste', opcoes.juntos);
      const erro = (c?.video && w.erros.video) || (c?.audio && w.erros.audio);
      if (erro) throw new DOMException('o erro do teste', erro);
      const f = await original(c);
      w.cameras.push(...f.getVideoTracks());
      return f;
    };
    const p = opcoes.permissoes;
    if (p === 'lanca') {
      navigator.permissions.query = () => {
        throw new TypeError('o erro do teste');
      };
    } else if (p) {
      navigator.permissions.query = async (d: PermissionDescriptor) =>
        ({ state: p[d.name as 'microphone' | 'camera'] }) as unknown as PermissionStatus;
    }
  }, opcoes);
}

const pedidos = (page: Page) => page.evaluate(() => (window as unknown as { pedidos: string[] }).pedidos);
const restricoesDeMidia = (page: Page) =>
  page.evaluate(() => (window as unknown as { restricoesDeMidia: unknown[] }).restricoesDeMidia);

/** As faixas de câmera vivas no fluxo da prévia da entrada. */
const camerasVivas = (page: Page) =>
  page
    .locator('video.previa')
    .first()
    .evaluate((v: HTMLVideoElement) =>
      (v.srcObject as MediaStream | null)?.getVideoTracks().filter((t) => t.readyState === 'live').length ?? 0,
    );

/**
 * O registro da página, na ordem: cada play() de um elemento de mídia e cada fetch, com "no clique" quando ele sai
 * dentro de um manipulador de click da página, antes de qualquer coisa assíncrona, ou "fora do clique" (o contador
 * do clique, de ligacoes-falsas.ts).
 */
async function registrar(page: Page): Promise<void> {
  await contarOClique(page);
  await page.addInitScript(() => {
    const w = window as unknown as { registro: string[]; ondeEstaOClique: () => string };
    w.registro = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      w.registro.push(`play #${this.id} ${w.ondeEstaOClique()}`);
      return play.call(this);
    };
    const buscar = window.fetch;
    window.fetch = function (entrada: RequestInfo | URL, init?: RequestInit) {
      const url = entrada instanceof Request ? entrada.url : String(entrada);
      w.registro.push(`fetch ${new URL(url, location.href).pathname} ${w.ondeEstaOClique()}`);
      return buscar.call(window, entrada, init);
    };
  });
}

const registro = (page: Page) => page.evaluate(() => (window as unknown as { registro: string[] }).registro);

/**
 * Cada close() de um WebSocket da página, com o bilhete e o readyState daquela hora. Vem depois do RedeFalsa.instalar:
 * o WebSocket da página já é, então, o do page.routeWebSocket.
 */
async function gravarFechamentos(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { fechamentos: string[] };
    w.fechamentos = [];
    const fechar = WebSocket.prototype.close;
    WebSocket.prototype.close = function (this: WebSocket, ...args: [number?, string?]) {
      w.fechamentos.push(`${new URL(this.url).searchParams.get('bilhete')} ${this.readyState}`);
      return fechar.apply(this, args);
    };
  });
}

const fechamentos = (page: Page) =>
  page.evaluate(() => (window as unknown as { fechamentos: string[] }).fechamentos);
const abrires = async (page: Page) =>
  (await registro(page)).filter((l) => l.startsWith(`fetch /api/v1/pagina/reunioes/${CODIGO} `)).length;

const titulo = (page: Page, nome: string) => page.getByRole('heading', { level: 1, name: nome, exact: true });
const botao = (page: Page, nome: string) => page.getByRole('button', { name: nome, exact: true });

async function caixa(l: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const c = await l.boundingBox();
  if (!c) throw new Error('o elemento não está na tela');
  return c;
}

test('a entrada mostra o cabeçalho da marcada', async ({ page }) => {
  await abrir(page);
  await expect(page.getByText('Reunião marcada · Hoje, 14:00', { exact: true })).toBeVisible();
  await expect(titulo(page, 'Planejamento de dezembro')).toBeVisible();
});

test('o carregando mostra só o girando', async ({ page }) => {
  const rede = await abrir(page, { respostas: ['segurada'] });
  await expect.poll(() => rede.abrires.length).toBe(1);
  const girando = page.locator('.carregando');
  await expect(girando).toBeVisible();
  await expect(girando).toHaveAttribute('aria-hidden', 'true');
  await expect(girando).toHaveText('');
  await expect(page.locator('main [data-tela]:visible')).toHaveCount(0);

  rede.soltarAbrires();
  await expect(titulo(page, 'Planejamento de dezembro')).toBeVisible();
  await expect(girando).toBeHidden();
});

test('o Pedir para entrar só liga com um nome', async ({ page }) => {
  await abrir(page);
  const pedir = botao(page, 'Pedir para entrar');
  const nome = page.getByLabel('Seu nome');
  const dica = page.getByText('Digite o seu nome para pedir.', { exact: true });

  await expect(pedir).toBeDisabled();
  await expect(dica).toBeVisible();
  await nome.fill('   ');
  await expect(pedir).toBeDisabled();
  await expect(dica).toBeVisible();

  await nome.fill('Maria Lima');
  await expect(pedir).toBeEnabled();
  await expect(dica).toBeHidden();

  await expect(nome).toHaveAttribute('maxlength', '80');
  await nome.fill('a'.repeat(100));
  await expect(nome).toHaveValue('a'.repeat(80));
});

test('o Microfone e a Câmera trocam', async ({ page }) => {
  await abrir(page);
  await esperarAMidia(page);
  const mic = botao(page, 'Microfone');
  const cam = botao(page, 'Câmera');
  const desligada = page.getByText('A câmera está desligada', { exact: true });

  await expect(mic).toHaveAttribute('aria-pressed', 'true');
  await expect(cam).toHaveAttribute('aria-pressed', 'true');
  await expect(desligada).toBeHidden();

  await mic.click();
  await expect(mic).toHaveAttribute('aria-pressed', 'false');
  await cam.click();
  await expect(cam).toHaveAttribute('aria-pressed', 'false');
  await expect(desligada).toBeVisible();

  await cam.click();
  await expect(cam).toHaveAttribute('aria-pressed', 'true');
  await expect(desligada).toBeHidden();
  await mic.click();
  await expect(mic).toHaveAttribute('aria-pressed', 'true');
});

test('sem acesso a nada', async ({ page }) => {
  await midiaComErro(page, { tudo: 'NotAllowedError' });
  await abrir(page);

  const alerta = page.getByRole('alert');
  await expect(alerta.getByText(AVISO_DE_ACESSO, { exact: true })).toBeVisible();
  await expect(alerta.getByText(TEXTO_DE_ACESSO, { exact: true })).toBeVisible();
  await expect(alerta.getByRole('button', { name: 'Tentar de novo', exact: true })).toBeVisible();
  await expect(botao(page, 'Microfone')).toBeDisabled();
  await expect(botao(page, 'Câmera')).toBeDisabled();
  await expect(page.getByText('Sem a permissão, os dois ficam desligados.', { exact: true })).toBeVisible();
  await expect(page.getByText('O navegador não deixou usar a câmera', { exact: true })).toBeVisible();

  await page.getByLabel('Seu nome').fill('Maria Lima');
  await expect(botao(page, 'Pedir para entrar')).toBeEnabled();
});

test('só sem câmera', async ({ page }) => {
  await midiaComErro(page, { video: 'NotFoundError' });
  await abrir(page);

  await expect(page.getByRole('alert').getByText(AVISO_DE_ACESSO, { exact: true })).toBeVisible();
  await expect(botao(page, 'Microfone')).toBeEnabled();
  await expect(botao(page, 'Microfone')).toHaveAttribute('aria-pressed', 'true');
  await expect(botao(page, 'Câmera')).toBeDisabled();
  await expect(page.getByText(SEM_CAMERA, { exact: true })).toBeVisible();
  await expect(page.getByText('Sem a permissão, os dois ficam desligados.', { exact: true })).toBeHidden();
});

test('a câmera ocupada', async ({ page }) => {
  await midiaComErro(page, { video: 'NotReadableError' });
  await abrir(page);

  const aviso = page.getByRole('alert').getByText(AVISO_DE_ACESSO, { exact: true });
  await expect(aviso).toBeVisible();
  await expect(botao(page, 'Câmera')).toBeDisabled();

  // O outro programa soltou a câmera: o Tentar de novo pede a mídia outra vez, e ela chega.
  const antes = await pedidosDeMidia(page);
  await page.evaluate(() => {
    (window as unknown as { midiaLivre: boolean }).midiaLivre = true;
  });
  await page.getByRole('alert').getByRole('button', { name: 'Tentar de novo', exact: true }).click();
  await expect.poll(() => pedidosDeMidia(page)).toBeGreaterThan(antes);
  await expect(aviso).toBeHidden();
  await expect(botao(page, 'Câmera')).toBeEnabled();
  await expect(botao(page, 'Câmera')).toHaveAttribute('aria-pressed', 'true');
  // O botão com o foco sumiu com o aviso: o foco vai ao título.
  await expect(titulo(page, 'Planejamento de dezembro')).toBeFocused();
});

// Depois de um pedido de permissão fechado sem resposta (o NotAllowedError), pedir de novo abriria outro pedido: só
// vale pedir sozinho o aparelho liberado, ou o que está por perguntar quando o outro foi bloqueado.
test.describe('o pedido de permissão fechado', () => {
  const recusado = 'NotAllowedError';

  test('os dois por perguntar: um pedido só', async ({ page }) => {
    await midiaFalsa(page, { juntos: recusado, permissoes: { microphone: 'prompt', camera: 'prompt' } });
    await abrir(page);
    await expect(page.getByText('Sem a permissão, os dois ficam desligados.', { exact: true })).toBeVisible();
    await expect(botao(page, 'Microfone')).toBeDisabled();
    await expect(botao(page, 'Câmera')).toBeDisabled();
    expect(await pedidos(page)).toEqual(['audio+video']);
  });

  test('a câmera bloqueada: o microfone sozinho', async ({ page }) => {
    await midiaFalsa(page, { juntos: recusado, permissoes: { microphone: 'prompt', camera: 'denied' } });
    await abrir(page);
    await expect(botao(page, 'Câmera')).toBeDisabled();
    await expect(botao(page, 'Microfone')).toBeEnabled();
    await expect(page.getByRole('alert').getByText(AVISO_DE_ACESSO, { exact: true })).toBeVisible();
    expect(await pedidos(page)).toEqual(['audio+video', 'audio']);
  });

  test('o microfone liberado: só ele sozinho', async ({ page }) => {
    await midiaFalsa(page, { juntos: recusado, permissoes: { microphone: 'granted', camera: 'prompt' } });
    await abrir(page);
    await expect(botao(page, 'Câmera')).toBeDisabled();
    await expect(botao(page, 'Microfone')).toBeEnabled();
    await expect(botao(page, 'Microfone')).toHaveAttribute('aria-pressed', 'true');
    expect(await pedidos(page)).toEqual(['audio+video', 'audio']);
  });

  test('a consulta das permissões lança: um pedido só', async ({ page }) => {
    await midiaFalsa(page, { juntos: recusado, permissoes: 'lanca' });
    await abrir(page);
    await expect(page.getByText('Sem a permissão, os dois ficam desligados.', { exact: true })).toBeVisible();
    expect(await pedidos(page)).toEqual(['audio+video']);
  });
});

// Fora da reunião, a luz da câmera concorda com a escolha: a câmera desligada para e sai do fluxo.
test.describe('a câmera desligada fora da reunião', () => {
  test('desligada, ela para; ligada de novo, ela é pedida sozinha', async ({ page }) => {
    await midiaFalsa(page, {});
    await abrir(page);
    await esperarAMidia(page);
    const previa = page.locator('video.previa').first();
    const fluxoDoComeco = await previa.evaluateHandle((v: HTMLVideoElement) => v.srcObject);
    expect(await camerasVivas(page)).toBe(1);

    await botao(page, 'Câmera').click();
    await expect.poll(() => camerasVivas(page)).toBe(0);
    // A faixa da câmera parou (a luz apaga).
    const primeira = await page.evaluate(
      () => (window as unknown as { cameras: MediaStreamTrack[] }).cameras[0].readyState,
    );
    expect(primeira).toBe('ended');

    await botao(page, 'Câmera').click();
    await expect.poll(() => camerasVivas(page)).toBe(1);
    expect(await pedidos(page)).toEqual(['audio+video', 'video']);
    // As prévias continuam com o mesmo fluxo: a faixa saiu e voltou nele.
    expect(await previa.evaluate((v: HTMLVideoElement, f) => v.srcObject === f, fluxoDoComeco)).toBe(true);
  });

  test('a câmera pedida antes de desligada de novo fica de fora', async ({ page }) => {
    await midiaFalsa(page, {});
    await abrir(page);
    await esperarAMidia(page);
    const camera = botao(page, 'Câmera');
    await camera.click();
    await expect.poll(() => camerasVivas(page)).toBe(0);
    await page.evaluate(() => {
      (window as unknown as { seguraCamera: boolean }).seguraCamera = true;
    });
    await camera.click(); // ligada: o pedido dela espera
    await expect.poll(() => pedidos(page)).toEqual(['audio+video', 'video']);
    await camera.click(); // desligada de novo, antes da resposta
    await camera.click(); // e ligada outra vez: um pedido de cada vez, nenhum novo ainda
    expect(await pedidos(page)).toEqual(['audio+video', 'video']);

    // A resposta do pedido de antes para e fica de fora; a câmera é pedida de novo, e volta.
    await page.evaluate(() => {
      const w = window as unknown as { seguraCamera: boolean; soltarCamera: () => void };
      w.seguraCamera = false;
      w.soltarCamera();
    });
    await expect.poll(() => camerasVivas(page)).toBe(1);
    expect(await pedidos(page)).toEqual(['audio+video', 'video', 'video']);
    const estados = await page.evaluate(() =>
      (window as unknown as { cameras: MediaStreamTrack[] }).cameras.map((t) => t.readyState),
    );
    expect(estados).toEqual(['ended', 'ended', 'live']);
  });

  test('a câmera que não volta é a que falta', async ({ page }) => {
    await midiaFalsa(page, {});
    await abrir(page);
    await esperarAMidia(page);
    await botao(page, 'Microfone').click();
    await botao(page, 'Câmera').click();
    await expect.poll(() => camerasVivas(page)).toBe(0);

    // Outro programa pegou a câmera: ela não volta, e o aviso de acesso aparece, com o microfone como estava.
    await page.evaluate(() => {
      (window as unknown as { erros: Record<string, string> }).erros.video = 'NotReadableError';
    });
    await botao(page, 'Câmera').click();
    await expect(page.getByRole('alert').getByText(AVISO_DE_ACESSO, { exact: true })).toBeVisible();
    await expect(botao(page, 'Câmera')).toBeDisabled();
    await expect(page.getByText('O navegador não deixou usar a câmera', { exact: true })).toBeVisible();
    await expect(botao(page, 'Microfone')).toBeEnabled();
    await expect(botao(page, 'Microfone')).toHaveAttribute('aria-pressed', 'false');
    expect(await pedidos(page)).toEqual(['audio+video', 'video']);
  });

  test('o fluxo novo chega sem a câmera desligada', async ({ page }) => {
    // Sem microfone: o aviso de acesso aparece, com a câmera funcionando.
    await midiaFalsa(page, { erros: { audio: 'NotFoundError' } });
    await abrir(page);
    await expect(page.getByRole('alert').getByText(AVISO_DE_ACESSO, { exact: true })).toBeVisible();
    await expect.poll(() => camerasVivas(page)).toBe(1);
    await botao(page, 'Câmera').click();
    await expect.poll(() => camerasVivas(page)).toBe(0);

    // O Tentar de novo pede os dois outra vez; a câmera que vem no fluxo novo para, porque a escolha é desligada.
    await page.getByRole('alert').getByRole('button', { name: 'Tentar de novo', exact: true }).click();
    await expect
      .poll(() => pedidos(page))
      .toEqual(['audio+video', 'audio', 'video', 'audio+video', 'audio', 'video']);
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { cameras: MediaStreamTrack[] }).cameras.map((t) => t.readyState)),
      )
      .toEqual(['ended', 'ended']);
    expect(await camerasVivas(page)).toBe(0);
    await expect(botao(page, 'Câmera')).toHaveAttribute('aria-pressed', 'false');
  });
});

/**
 * O aparelho acaba sozinho (desligado da USB, tomado por outro programa): a faixa dele acaba, e o navegador dispara o
 * ended, o que ele só faz para um fim que a página não causou.
 */
const acabarSozinha = (page: Page, tipo: 'audio' | 'video') =>
  page
    .locator('video.previa')
    .first()
    .evaluate((v: HTMLVideoElement, tipo) => {
      const [t] = (v.srcObject as MediaStream).getTracks().filter((f) => f.kind === tipo);
      t.stop();
      t.dispatchEvent(new Event('ended'));
    }, tipo);

/** As faixas do fluxo da prévia da entrada, vivas ou não, de um tipo. */
const faixasNoFluxo = (page: Page, tipo: 'audio' | 'video') =>
  page
    .locator('video.previa')
    .first()
    .evaluate(
      (v: HTMLVideoElement, tipo) => (v.srcObject as MediaStream).getTracks().filter((f) => f.kind === tipo).length,
      tipo,
    );

test.describe('o aparelho que acaba sozinho', () => {
  test('a câmera sai do fluxo e passa a faltar', async ({ page }) => {
    await midiaFalsa(page, {});
    await abrir(page);
    await esperarAMidia(page);
    await botao(page, 'Microfone').click();

    await acabarSozinha(page, 'video');
    await expect(page.getByRole('alert').getByText(AVISO_DE_ACESSO, { exact: true })).toBeVisible();
    await expect(botao(page, 'Câmera')).toBeDisabled();
    await expect(page.getByText('O navegador não deixou usar a câmera', { exact: true })).toBeVisible();
    expect(await faixasNoFluxo(page, 'video')).toBe(0);
    // O microfone fica como a pessoa o deixou, e nada é pedido de novo sozinho (o Tentar de novo pede os dois).
    await expect(botao(page, 'Microfone')).toBeEnabled();
    await expect(botao(page, 'Microfone')).toHaveAttribute('aria-pressed', 'false');
    expect(await pedidos(page)).toEqual(['audio+video']);
  });

  test('o microfone sai do fluxo e passa a faltar', async ({ page }) => {
    await midiaFalsa(page, {});
    await abrir(page);
    await esperarAMidia(page);
    // A câmera desligada pela pessoa (fora do fluxo) não falta: ela continua só desligada.
    await botao(page, 'Câmera').click();
    await expect.poll(() => camerasVivas(page)).toBe(0);

    await acabarSozinha(page, 'audio');
    await expect(page.getByRole('alert').getByText(AVISO_DE_ACESSO, { exact: true })).toBeVisible();
    await expect(botao(page, 'Microfone')).toBeDisabled();
    expect(await faixasNoFluxo(page, 'audio')).toBe(0);
    await expect(botao(page, 'Câmera')).toBeEnabled();
    await expect(botao(page, 'Câmera')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText('A câmera está desligada', { exact: true })).toBeVisible();
    expect(await pedidos(page)).toEqual(['audio+video']);
  });

  test('a faixa que a página para não é um aparelho que falta', async ({ page }) => {
    await midiaFalsa(page, {});
    await abrir(page);
    await esperarAMidia(page);
    // A Câmera desligada para a faixa (o stop da própria página, sem o ended): nada é avisado.
    await botao(page, 'Câmera').click();
    await expect.poll(() => camerasVivas(page)).toBe(0);
    await page.clock.runFor(1000);
    await expect(page.getByRole('alert')).toBeHidden();
    await expect(botao(page, 'Câmera')).toBeEnabled();
    await expect(botao(page, 'Câmera')).toHaveAttribute('aria-pressed', 'false');
    await expect(botao(page, 'Microfone')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a câmera que voltou também', async ({ page }) => {
    await midiaFalsa(page, {});
    await abrir(page);
    await esperarAMidia(page);
    await botao(page, 'Câmera').click();
    await expect.poll(() => camerasVivas(page)).toBe(0);
    await botao(page, 'Câmera').click(); // a câmera pedida sozinha volta ao fluxo
    await expect.poll(() => camerasVivas(page)).toBe(1);

    await acabarSozinha(page, 'video');
    await expect(page.getByRole('alert').getByText(AVISO_DE_ACESSO, { exact: true })).toBeVisible();
    await expect(botao(page, 'Câmera')).toBeDisabled();
    expect(await faixasNoFluxo(page, 'video')).toBe(0);
    expect(await pedidos(page)).toEqual(['audio+video', 'video']);
  });

  test('na reunião também', async ({ page }) => {
    await midiaFalsa(page, {});
    await naReuniao(page);
    await acabarSozinha(page, 'video');
    await expect(botao(page, 'Câmera')).toBeDisabled();
    expect(await faixasNoFluxo(page, 'video')).toBe(0);
    await expect(botao(page, 'Microfone')).toBeEnabled();
    await expect(botao(page, 'Microfone')).toHaveAttribute('aria-pressed', 'true');
    expect(await pedidos(page)).toEqual(['audio+video']);
  });

  test('com um pedido em curso, só a resposta dele diz os aparelhos', async ({ page }) => {
    // Sem microfone: o aviso de acesso aparece, com a câmera funcionando.
    await midiaFalsa(page, { erros: { audio: 'NotFoundError' } });
    await abrir(page);
    await expect(page.getByRole('alert').getByText(AVISO_DE_ACESSO, { exact: true })).toBeVisible();
    await expect.poll(() => camerasVivas(page)).toBe(1);

    // O Tentar de novo pede os dois outra vez, e o pedido da câmera sozinha dele espera.
    await page.evaluate(() => {
      (window as unknown as { seguraCamera: boolean }).seguraCamera = true;
    });
    await page.getByRole('alert').getByRole('button', { name: 'Tentar de novo', exact: true }).click();
    await expect
      .poll(() => pedidos(page))
      .toEqual(['audio+video', 'audio', 'video', 'audio+video', 'audio', 'video']);

    // A câmera do fluxo de antes acaba sozinha: ela sai do fluxo, e nada vai ao cérebro antes da resposta do pedido
    // (um midia agora acabaria a espera da mídia, e uma senha que chegasse ligaria com o fluxo que o pedido vai parar).
    await acabarSozinha(page, 'video');
    expect(await faixasNoFluxo(page, 'video')).toBe(0);
    await expect(botao(page, 'Câmera')).toBeEnabled();
    await expect(botao(page, 'Câmera')).toHaveAttribute('aria-pressed', 'true');

    await page.evaluate(() => {
      const w = window as unknown as { seguraCamera: boolean; soltarCamera: () => void };
      w.seguraCamera = false;
      w.soltarCamera();
    });
    await expect.poll(() => camerasVivas(page)).toBe(1);
    await expect(botao(page, 'Câmera')).toBeEnabled();
    await expect(botao(page, 'Câmera')).toHaveAttribute('aria-pressed', 'true');
  });
});

test('o primeiro play nasce no clique', async ({ page }) => {
  await registrar(page);
  await abrir(page);
  await page.getByLabel('Seu nome').fill('Maria Lima');
  const antes = (await registro(page)).length;

  await botao(page, 'Pedir para entrar').click();

  // Dentro do próprio manipulador do clique, antes de qualquer coisa assíncrona, o play() do #som vem antes do abrir, o
  // primeiro pedido de rede. E é o primeiro play() da página: antes do clique, nenhum.
  await expect.poll(async () => (await registro(page)).slice(antes, antes + 2)).toEqual([
    'play #som no clique',
    `fetch /api/v1/pagina/reunioes/${CODIGO} no clique`,
  ]);
  expect((await registro(page)).slice(0, antes).filter((l) => l.startsWith('play '))).toEqual([]);
});

test('o Enter no nome também dá o play antes do pedido', async ({ page }) => {
  await registrar(page);
  await abrir(page);
  const nome = page.getByLabel('Seu nome');
  await nome.fill('Maria Lima');
  const antes = (await registro(page)).length;

  // O Enter que confirma uma composição (o IME) não pede nada.
  await nome.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  expect((await registro(page)).slice(antes)).toEqual([]);
  await expect(titulo(page, 'Planejamento de dezembro')).toBeVisible();

  // O Enter dá o clique do Pedir para entrar: o play() sai dentro do manipulador dele.
  await nome.press('Enter');
  await expect.poll(async () => (await registro(page)).slice(antes, antes + 2)).toEqual([
    'play #som no clique',
    `fetch /api/v1/pagina/reunioes/${CODIGO} no clique`,
  ]);
  expect((await registro(page)).slice(0, antes).filter((l) => l.startsWith('play '))).toEqual([]);
});

test('a espera', async ({ page }) => {
  const rede = await abrir(page);
  rede.aoPedir = (c) => c.mandar({ tipo: 'aguardando' });
  await pedirParaEntrar(page);

  const aguardando = titulo(page, 'Aguardando ser aceito…');
  await expect(aguardando).toBeVisible();
  await expect(aguardando).toBeFocused();
  await expect(page.getByRole('status')).toHaveText('Aguardando ser aceito…');
  const linha = page.getByText('Planejamento de dezembro · Hoje, 14:00', { exact: true });
  await expect(linha.filter({ visible: true })).toBeVisible();
  const canal = await rede.canalNumero(1);
  expect(canal.bilhete).toBe('bilhete-2');
  expect(canal.recebidas).toEqual([{ tipo: 'pedir', nome: 'Maria Lima' }]);

  canal.mandar({ tipo: 'naoComecou' });
  await expect(titulo(page, 'A reunião ainda não começou')).toBeVisible();
  await expect(page.getByText('Você vai entrar como Maria Lima', { exact: true })).toBeVisible();

  await botao(page, 'Desistir').click();
  await expect.poll(() => canal.recebidas).toEqual([{ tipo: 'pedir', nome: 'Maria Lima' }, { tipo: 'desistir' }]);
  await expect.poll(() => canal.fechadoPelaPagina).toBe(1000);
  await expect(titulo(page, 'Planejamento de dezembro')).toBeVisible();
  await expect(page.getByLabel('Seu nome')).toHaveValue('Maria Lima');
});

test.describe('cada aviso', () => {
  const PELO_CANAL: Array<{ mensagem: string; titulo: string; texto: string; botao?: string }> = [
    {
      mensagem: 'recusado',
      titulo: 'Não foi possível entrar',
      texto: 'O seu pedido não foi aceito. Se achar que foi engano, fale com quem mandou o link.',
    },
    {
      mensagem: 'cheia',
      titulo: 'A reunião está cheia',
      texto: 'Ela já tem 10 pessoas. Tente de novo quando alguém sair.',
      botao: 'Tentar de novo',
    },
    {
      mensagem: 'esperaCheia',
      titulo: 'Muita gente esperando para entrar',
      texto: 'A sala de espera está cheia. Tente de novo daqui a pouco.',
      botao: 'Tentar de novo',
    },
    {
      mensagem: 'servidorCheio',
      titulo: 'O servidor de reuniões está cheio agora',
      texto: 'Há muitas reuniões ao mesmo tempo. Tente de novo daqui a alguns minutos.',
      botao: 'Tentar de novo',
    },
    {
      mensagem: 'semServidor',
      titulo: 'O servidor de reuniões não respondeu',
      texto: 'Tente de novo daqui a pouco. Se continuar, avise quem mandou o link.',
      botao: 'Tentar de novo',
    },
    {
      mensagem: 'linkInvalido',
      titulo: 'Este link não vale mais',
      texto: 'A reunião foi cancelada, passou da data ou já acabou. Peça um link novo a quem convidou você.',
    },
    { mensagem: 'tirado', titulo: 'Você foi tirado da reunião', texto: 'Um colega da empresa tirou você da reunião.' },
    {
      mensagem: 'encerrada',
      titulo: 'A reunião acabou',
      texto: 'Um colega encerrou a reunião para todos, ou ela foi cancelada.',
    },
  ];

  for (const caso of PELO_CANAL) {
    test(`o ${caso.mensagem} do canal`, async ({ page }) => {
      const rede = await abrir(page);
      rede.aoPedir = (c) => c.mandar({ tipo: caso.mensagem });
      await pedirParaEntrar(page);

      await expect(titulo(page, caso.titulo)).toBeVisible();
      await expect(titulo(page, caso.titulo)).toBeFocused();
      await expect(page.getByText(caso.texto, { exact: true })).toBeVisible();
      const botoes = page.getByRole('main').getByRole('button');
      if (caso.botao) {
        await expect(botoes).toHaveCount(1);
        await expect(botoes).toHaveText(caso.botao);
        await expect(botoes).toBeEnabled();
      } else {
        await expect(botoes).toHaveCount(0);
      }
    });
  }

  test('o Tentar de novo da cheia pede de novo no mesmo canal', async ({ page }) => {
    const rede = await abrir(page);
    rede.aoPedir = (c) => c.mandar({ tipo: c.tipos().length === 1 ? 'cheia' : 'aguardando' });
    await pedirParaEntrar(page);
    await expect(titulo(page, 'A reunião está cheia')).toBeVisible();

    await botao(page, 'Tentar de novo').click();
    await expect(titulo(page, 'Aguardando ser aceito…')).toBeVisible();
    const canal = await rede.canalNumero(1);
    expect(canal.recebidas).toEqual([
      { tipo: 'pedir', nome: 'Maria Lima' },
      { tipo: 'pedir', nome: 'Maria Lima' },
    ]);
    expect(rede.canais).toHaveLength(1);
    expect(rede.abrires).toHaveLength(2);
  });

  test('o 404 do abrir', async ({ page }) => {
    await abrir(page, { respostas: [{ status: 404, corpo: { erro: 'naoEncontrado' } }] });
    await expect(titulo(page, 'Este link não vale mais')).toBeVisible();
    await expect(
      page.getByText(
        'A reunião foi cancelada, passou da data ou já acabou. Peça um link novo a quem convidou você.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
  });

  test('o 429 do abrir conta até poder tentar de novo', async ({ page }) => {
    const rede = await abrir(page, { respostas: [{ status: 429, corpo: { erro: 'tentativas', esperarSegundos: 3 } }] });
    await expect(titulo(page, 'Muitas tentativas')).toBeVisible();
    await expect(
      page.getByText('Este endereço tentou abrir links demais. Espere um pouco para tentar de novo.', { exact: true }),
    ).toBeVisible();
    const botoes = page.getByRole('main').getByRole('button');
    await expect(botoes).toHaveCount(1);

    // O texto que aparece (o innerText), e o nome que o leitor de tela lê.
    for (const n of [3, 2, 1]) {
      await expect(botoes).toHaveText(`Tentar de novo em ${n} s`, { useInnerText: true });
      await expect(botoes).toHaveAccessibleName(`Tentar de novo em ${n} s`);
      await expect(botoes).toBeDisabled();
      await page.clock.runFor(1000);
    }
    await expect(botoes).toHaveText('Tentar de novo', { useInnerText: true });
    await expect(botoes).toHaveAccessibleName('Tentar de novo');
    await expect(botoes).toBeEnabled();

    // Liga: o Tentar de novo abre de novo, e a entrada aparece.
    await botoes.click();
    await expect(titulo(page, 'Planejamento de dezembro')).toBeVisible();
    expect(rede.abrires).toHaveLength(2);
  });
});

test('o nome recusado', async ({ page }) => {
  const rede = await abrir(page);
  rede.aoPedir = (c) => c.mandar({ tipo: 'erro', erro: 'invalido' });
  await pedirParaEntrar(page);

  const confira = page.getByText('Confira o seu nome.', { exact: true });
  await expect(confira).toBeVisible();
  await expect(titulo(page, 'Planejamento de dezembro')).toBeVisible();
  await expect(page.getByLabel('Seu nome')).toHaveAttribute('aria-invalid', 'true');
  const canal = await rede.canalNumero(1);
  await expect.poll(() => canal.fechadoPelaPagina).toBe(1000);

  // Ao mexer no nome, o aviso sai.
  await page.getByLabel('Seu nome').fill('Maria Lima Souza');
  await expect(confira).toBeHidden();
  await expect(page.getByLabel('Seu nome')).not.toHaveAttribute('aria-invalid', 'true');
});

test('o 1011 abre de novo sozinho', async ({ page }) => {
  await registrar(page);
  const rede = await abrir(page);
  rede.aoPedir = (c) => c.mandar({ tipo: 'aguardando' });
  await pedirParaEntrar(page);
  await expect(titulo(page, 'Aguardando ser aceito…')).toBeVisible();
  const canal = await rede.canalNumero(1);
  expect(await abrires(page)).toBe(2);

  await canal.fechar(1011);
  await page.clock.runFor(2_999);
  expect(await abrires(page)).toBe(2);
  await page.clock.runFor(1);
  expect(await abrires(page)).toBe(3);

  // O novo abrir dá o canal novo, que pede de novo; a tela continua a da espera.
  const segundo = await rede.canalNumero(2);
  expect(segundo.bilhete).toBe('bilhete-3');
  await expect.poll(() => segundo.recebidas).toEqual([{ tipo: 'pedir', nome: 'Maria Lima' }]);
  await expect(titulo(page, 'Aguardando ser aceito…')).toBeVisible();
});

test('o aceito leva a Entrando', async ({ page }) => {
  const rede = await abrir(page);
  await esperarAMidia(page);
  await pedirParaEntrar(page);
  const canal = await rede.canalNumero(1);
  await expect.poll(() => canal.tipos()).toEqual(['pedir']);

  canal.mandar(ACEITO);
  await expect(titulo(page, 'Entrando na reunião…')).toBeVisible();

  // O servidor de vídeo fecha o WSS na hora: a ligação falhou, sem esperar o prazo de 10 s da conexão.
  const video = await rede.videoNumero(1);
  expect(video.url).toBe('wss://video.exemplo.com.br:7443/sip');
  await video.fechar();
  await expect(titulo(page, 'O servidor de reuniões não respondeu')).toBeVisible();
  await expect(
    page.getByText('Tente de novo daqui a pouco. Se continuar, avise quem mandou o link.', { exact: true }),
  ).toBeVisible();
  await expect(botao(page, 'Tentar de novo')).toBeEnabled();
});

test('o Sair do Entrando', async ({ page }) => {
  const rede = await abrir(page);
  await esperarAMidia(page);
  await pedirParaEntrar(page);
  const canal = await rede.canalNumero(1);
  await expect.poll(() => canal.tipos()).toEqual(['pedir']);
  canal.mandar(ACEITO);
  await expect(titulo(page, 'Entrando na reunião…')).toBeVisible();

  // Antes da resposta da ligação, o Sair leva ao saiu; a resposta que viria depois não muda a tela.
  await botao(page, 'Sair').click();
  await expect(titulo(page, 'Você saiu da reunião')).toBeVisible();
  await page.clock.runFor(10);
  await expect(titulo(page, 'Você saiu da reunião')).toBeVisible();
});

/** O aceito com o TURN neste computador, numa porta fechada: a ligação que abre o WSS falso não sai para a rede. */
const ACEITO_SEM_REDE: Mensagem = {
  ...ACEITO,
  turn: {
    urls: ['turn:127.0.0.1:9?transport=udp', 'turns:127.0.0.1:9?transport=tcp'],
    usuario: 'usuario-1',
    senha: 'credencial-1',
  },
};

/** A última ligação manda a câmera: o emissor do vídeo dela tem uma faixa viva (sem a câmera, ele vai sem faixa). */
const cameraNaLigacao = (page: Page) =>
  page.evaluate(() => {
    const pc = (window as unknown as { conexoes: RTCPeerConnection[] }).conexoes.at(-1);
    return pc?.getSenders().some((s) => s.track?.kind === 'video' && s.track.readyState === 'live') ?? false;
  });

test('a ligação leva a senha, o TURN e a câmera', async ({ page }) => {
  await registrarConexoes(page);
  const rede = await abrir(page);
  rede.videosAbrem = true;
  await esperarAMidia(page);
  rede.aoPedir = (c) => c.mandar(ACEITO_SEM_REDE);
  await pedirParaEntrar(page);
  const video = await rede.videoNumero(1);
  const invite = await inviteDe(page, video);

  // Um UA só para a ligação, sem registro, com o From e o nome neutros, a senha do aceito e o TURN dele.
  expect(invite.split('\r\n')[0]).toBe('INVITE sip:reuniao@video.exemplo.com.br SIP/2.0');
  expect(cabecalhoSip(invite, 'From')).toMatch(/^"pagina" <sip:pagina@video\.exemplo\.com\.br>;tag=/);
  // O Via diz WS, também pelo wss: o agente termina o TLS, e o FreeSWITCH 1.11.3, que lê o WebSocket sem TLS, não
  // responde (nem com o 100 Trying) a um Via WSS.
  expect(cabecalhoSip(invite, 'Via')).toMatch(/^SIP\/2\.0\/WS [^ ;]+\.invalid;branch=/);
  expect(cabecalhoSip(invite, 'X-Starsonic-Senha')).toBe('senha-1');
  expect(video.recebidas.filter((m) => m.startsWith('REGISTER '))).toEqual([]);
  const configuracoes = await page.evaluate(() => (window as unknown as { configuracoes: unknown[] }).configuracoes);
  expect(configuracoes).toEqual([
    {
      iceServers: [
        {
          urls: ['turn:127.0.0.1:9?transport=udp', 'turns:127.0.0.1:9?transport=tcp'],
          username: 'usuario-1',
          credential: 'credencial-1',
        },
      ],
    },
  ]);
  // A câmera e o microfone ligados: os dois mandam e recebem.
  expect(direcoes(invite)).toEqual({ audio: 'sendrecv', video: 'sendrecv' });
  expect(await cameraNaLigacao(page)).toBe(true);
});

test('o WSS do vídeo que não abre desiste em 10 s', async ({ page }) => {
  const rede = await abrir(page);
  await esperarAMidia(page);
  rede.aoPedir = (c) => c.mandar(ACEITO);
  await pedirParaEntrar(page);
  await rede.videoNumero(1);
  await page.clock.runFor(9_999);
  await expect(titulo(page, 'Entrando na reunião…')).toBeVisible();
  await page.clock.runFor(1);
  await expect(titulo(page, 'O servidor de reuniões não respondeu')).toBeVisible();
});

// O candidato do TURN (o relay) basta: a oferta sai com ele, sem esperar o prazo da coleta. No teste, ele é um evento
// de mentira da conexão, até a ligação o ouvir.
test('o candidato do TURN manda o INVITE na hora', async ({ page }) => {
  await registrarConexoes(page);
  const rede = await abrir(page);
  rede.videosAbrem = true;
  await esperarAMidia(page);
  rede.aoPedir = (c) => c.mandar(ACEITO_SEM_REDE);
  await pedirParaEntrar(page);
  const video = await rede.videoNumero(1);
  await expect
    .poll(async () => {
      await page.evaluate(() => {
        const pc = (window as unknown as { conexoes: RTCPeerConnection[] }).conexoes.at(-1);
        const candidate = new RTCIceCandidate({
          candidate: 'candidate:1 1 udp 41885439 192.0.2.10 49152 typ relay raddr 0.0.0.0 rport 0',
          sdpMid: '0',
        });
        pc?.dispatchEvent(new RTCPeerConnectionIceEvent('icecandidate', { candidate }));
      });
      return video.recebidas.some((m) => m.startsWith('INVITE '));
    })
    .toBe(true);
});

// Com o debug do JsSIP ligado no navegador (o localStorage de quem já o usou), o JsSIP escreveria no console as
// mensagens SIP, com a senha: a página o desliga antes do primeiro UA.
test('o console não mostra a senha nem o TURN', async ({ page }) => {
  const doConsole: string[] = [];
  page.on('console', (m) => doConsole.push(m.text()));
  await page.addInitScript(() => localStorage.setItem('debug', 'JsSIP:*'));
  await registrarConexoes(page);
  const rede = await abrir(page);
  rede.videosAbrem = true;
  await esperarAMidia(page);
  rede.aoPedir = (c) => c.mandar(ACEITO_SEM_REDE);
  await pedirParaEntrar(page);
  await inviteDe(page, await rede.videoNumero(1));
  const segredos = ['senha-1', 'usuario-1', 'credencial-1', 'volta-1'];
  expect(doConsole.filter((l) => segredos.some((s) => l.includes(s)))).toEqual([]);
});

// O FreeSWITCH só dá o quadro de quem está sem câmera a quem tem o vídeo nos dois sentidos: o vídeo vai sem a faixa.
test('a câmera desligada na entrada é o vídeo sem a faixa', async ({ page }) => {
  await registrarConexoes(page);
  const rede = await abrir(page);
  rede.videosAbrem = true;
  await esperarAMidia(page);
  await botao(page, 'Câmera').click();
  await expect.poll(() => camerasVivas(page)).toBe(0);
  rede.aoPedir = (c) => c.mandar(ACEITO_SEM_REDE);
  await pedirParaEntrar(page);
  expect(direcoes(await inviteDe(page, await rede.videoNumero(1)))).toEqual({ audio: 'sendrecv', video: 'sendrecv' });
  expect(await cameraNaLigacao(page)).toBe(false);
});

// A câmera é pedida com 1280×720 a 30 (o desenho): a imagem dela vai ao mosaico, e o quadro da pessoa fica nítido.
// Todo pedido que leva a câmera leva as mesmas restrições: o da entrada, o da câmera sozinha depois da permissão
// fechada, o da câmera ligada de novo na entrada, e o da câmera ligada na reunião (o da ligação).
const CAMERA_PEDIDA = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
  aspectRatio: { ideal: 16 / 9 },
  facingMode: { ideal: 'user' },
};

test('a câmera é pedida com 1280×720', async ({ page }) => {
  // O pedido dos dois juntos, fechado, e o microfone bloqueado: a câmera é pedida sozinha.
  await registrarConexoes(page);
  await midiaFalsa(page, { juntos: 'NotAllowedError', permissoes: { microphone: 'denied', camera: 'prompt' } });
  const rede = await abrir(page);
  rede.videosAbrem = true;
  await expect.poll(() => camerasVivas(page)).toBe(1);
  await expect(botao(page, 'Microfone')).toBeDisabled();
  expect(await restricoesDeMidia(page)).toEqual([{ audio: true, video: CAMERA_PEDIDA }, { video: CAMERA_PEDIDA }]);

  // Desligada e ligada de novo na entrada: pedida sozinha.
  await botao(page, 'Câmera').click();
  await expect.poll(() => camerasVivas(page)).toBe(0);
  await botao(page, 'Câmera').click();
  await expect.poll(() => camerasVivas(page)).toBe(1);
  expect(await restricoesDeMidia(page)).toEqual([
    { audio: true, video: CAMERA_PEDIDA },
    { video: CAMERA_PEDIDA },
    { video: CAMERA_PEDIDA },
  ]);

  // Na reunião, desligada e ligada de novo: a ligação a pede.
  rede.aoPedir = (c) => c.mandar(ACEITO_SEM_REDE);
  await pedirParaEntrar(page);
  const video = await rede.videoNumero(1);
  await atenderOInvite(page, video, await inviteDe(page, video));
  await expect(page.getByRole('navigation', { name: 'Controles da reunião' })).toBeVisible();
  await botao(page, 'Câmera').click();
  await expect(botao(page, 'Câmera')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => cameraNaLigacao(page)).toBe(false); // a troca acabou: o próximo clique vale
  await botao(page, 'Câmera').click();
  await expect(botao(page, 'Câmera')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => cameraNaLigacao(page), { message: 'a câmera no emissor do vídeo' }).toBe(true);
  expect(await restricoesDeMidia(page)).toEqual([
    { audio: true, video: CAMERA_PEDIDA },
    { video: CAMERA_PEDIDA },
    { video: CAMERA_PEDIDA },
    { video: CAMERA_PEDIDA },
  ]);
});

// R14: a câmera ligada de novo logo antes da ligação ainda pode estar sendo pedida no ligar. O ligar a espera (até
// 3 s), para a oferta concordar com o botão, e o desligar da mesma ligação, nesse meio-tempo, o cancela.
test.describe('a câmera ligada logo antes da ligação', () => {
  /** A câmera desligada e ligada de novo, com o pedido dela segurado; depois, o pedir, que o aceito responde. */
  async function comACameraSegurada(page: Page): Promise<RedeFalsa> {
    await registrarConexoes(page);
    await midiaFalsa(page, {});
    const rede = await abrir(page);
    rede.videosAbrem = true;
    await esperarAMidia(page);
    await botao(page, 'Câmera').click();
    await expect.poll(() => camerasVivas(page)).toBe(0);
    await page.evaluate(() => {
      (window as unknown as { seguraCamera: boolean }).seguraCamera = true;
    });
    await botao(page, 'Câmera').click();
    await expect.poll(() => pedidos(page)).toEqual(['audio+video', 'video']);
    rede.aoPedir = (c) => c.mandar(ACEITO_SEM_REDE);
    await pedirParaEntrar(page);
    await expect(titulo(page, 'Entrando na reunião…')).toBeVisible();
    return rede;
  }

  const soltarACamera = (page: Page) =>
    page.evaluate(() => {
      const w = window as unknown as { seguraCamera: boolean; soltarCamera: () => void };
      w.seguraCamera = false;
      w.soltarCamera();
    });

  test('o ligar espera a câmera, e a oferta a leva', async ({ page }) => {
    const rede = await comACameraSegurada(page);
    await page.clock.runFor(2_999);
    expect(rede.videos).toHaveLength(0);

    await soltarACamera(page);
    await inviteDe(page, await rede.videoNumero(1));
    expect(await cameraNaLigacao(page)).toBe(true);
  });

  test('o ligar não espera a câmera mais de 3 s', async ({ page }) => {
    const rede = await comACameraSegurada(page);
    await page.clock.runFor(3_000);
    await inviteDe(page, await rede.videoNumero(1));
    expect(await cameraNaLigacao(page)).toBe(false);
  });

  test('o desligar cancela o ligar que espera a câmera', async ({ page }) => {
    const rede = await comACameraSegurada(page);
    await botao(page, 'Sair').click();
    await expect(titulo(page, 'Você saiu da reunião')).toBeVisible();
    await soltarACamera(page);
    await page.clock.runFor(3_000);
    expect(rede.videos).toHaveLength(0);
    await expect(titulo(page, 'Você saiu da reunião')).toBeVisible();
  });

  /**
   * A câmera mais lenta que os 3 s: a oferta sai sem ela, e ela chega ao fluxo (a luz acende) antes de o servidor
   * atender. Devolve o WSS do vídeo e o INVITE.
   */
  async function comACameraDepoisDaOferta(page: Page): Promise<{ video: VideoFalso; invite: string }> {
    const rede = await comACameraSegurada(page);
    await page.clock.runFor(3_000);
    const video = await rede.videoNumero(1);
    const invite = await inviteDe(page, video);
    expect(await cameraNaLigacao(page)).toBe(false);
    await soltarACamera(page);
    await expect.poll(() => camerasVivas(page)).toBe(1);
    return { video, invite };
  }

  const controles = (page: Page) => page.getByRole('navigation', { name: 'Controles da reunião' });

  test('a câmera que chega depois da oferta vai na ligação confirmada', async ({ page }) => {
    const { video, invite } = await comACameraDepoisDaOferta(page);
    await atenderOInvite(page, video, invite);
    await expect(controles(page)).toBeVisible();
    await expect.poll(() => cameraNaLigacao(page), { message: 'a câmera no emissor do vídeo' }).toBe(true);
    await expect(botao(page, 'Câmera')).toHaveAttribute('aria-pressed', 'true');
    await expect(botao(page, 'Câmera')).toBeEnabled();
  });

  test('a câmera que chega depois da oferta e que a ligação recusa passa a faltar', async ({ page }) => {
    const { video, invite } = await comACameraDepoisDaOferta(page);
    // O emissor do vídeo recusa a câmera (o replaceTrack que o navegador não aceita).
    await page.evaluate(() => {
      const trocar = RTCRtpSender.prototype.replaceTrack;
      RTCRtpSender.prototype.replaceTrack = function (this: RTCRtpSender, faixa: MediaStreamTrack | null) {
        if (faixa?.kind === 'video') return Promise.reject(new DOMException('o erro do teste', 'InvalidStateError'));
        return trocar.call(this, faixa);
      };
    });
    await atenderOInvite(page, video, invite);
    await expect(controles(page)).toBeVisible();
    await expect(botao(page, 'Câmera')).toBeDisabled();
    expect(await camerasVivas(page)).toBe(0);
    const naPrevia = (v: HTMLVideoElement) => (v.srcObject as MediaStream).getVideoTracks().length;
    expect(await page.locator('video.previa').first().evaluate(naPrevia), 'as câmeras no fluxo').toBe(0);
    expect(await cameraNaLigacao(page)).toBe(false);
  });
});

/**
 * O registro do som da página: cada AudioContext criado e cada resume(), com o evento que o navegador despachava
 * naquela hora (window.event), ou "-" fora de um evento (window.som); os contextos ficam em window.contextos.
 */
async function registrarOSom(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { som: string[]; contextos: AudioContext[] };
    w.som = [];
    w.contextos = [];
    const evento = () => window.event?.type ?? '-';
    const Original = window.AudioContext;
    const acordar = Original.prototype.resume;
    Original.prototype.resume = function (this: AudioContext) {
      w.som.push(`resume ${evento()}`);
      return acordar.call(this);
    };
    window.AudioContext = class extends Original {
      constructor(...args: unknown[]) {
        super(...(args as [AudioContextOptions]));
        w.som.push(`novo ${evento()}`);
        w.contextos.push(this);
      }
    };
  });
}

const somDaPagina = (page: Page) => page.evaluate(() => (window as unknown as { som: string[] }).som);
const contextoDoSom = (page: Page) =>
  page.evaluate(() => (window as unknown as { contextos: AudioContext[] }).contextos.map((c) => c.state));
// O contexto parado de fora, como o Safari faz com a página que ficou para trás.
const pararOSom = (page: Page) =>
  page.evaluate(() => (window as unknown as { contextos: AudioContext[] }).contextos[0].suspend());

// O silêncio de quem está sem microfone vem de um AudioContext, que, fora de um gesto, começa parado: o destino de um
// contexto parado não manda RTP, e a ligação cairia pelo tempo sem mídia. Ele nasce e acorda nos cliques que levam à
// reunião, como o primeiro play() do som; antes deles, não existe.
test.describe('o silêncio nasce no clique', () => {
  test('no Pedir para entrar e no Entrar de novo', async ({ page }) => {
    await registrarOSom(page);
    const rede = await abrir(page);
    await esperarAMidia(page);
    rede.aoPedir = (c) => c.mandar(ACEITO);
    expect(await somDaPagina(page)).toEqual([]);

    await pedirParaEntrar(page);
    await expect(titulo(page, 'Entrando na reunião…')).toBeVisible();
    expect(await somDaPagina(page)).toEqual(['novo click', 'resume click']);

    await botao(page, 'Sair').click();
    await expect(titulo(page, 'Você saiu da reunião')).toBeVisible();
    await pararOSom(page);
    await botao(page, 'Entrar de novo').click();
    await expect(titulo(page, 'Entrando na reunião…')).toBeVisible();
    expect(await somDaPagina(page)).toEqual(['novo click', 'resume click', 'resume click']);
    await expect.poll(() => contextoDoSom(page)).toEqual(['running']);
  });

  test('no Tentar de novo', async ({ page }) => {
    await registrarOSom(page);
    const rede = await abrir(page);
    rede.aoPedir = (c) => c.mandar({ tipo: c.tipos().length === 1 ? 'cheia' : 'aguardando' });
    await pedirParaEntrar(page);
    await expect(titulo(page, 'A reunião está cheia')).toBeVisible();
    await pararOSom(page);
    await botao(page, 'Tentar de novo').click();
    await expect(titulo(page, 'Aguardando ser aceito…')).toBeVisible();
    expect(await somDaPagina(page)).toEqual(['novo click', 'resume click', 'resume click']);
    await expect.poll(() => contextoDoSom(page)).toEqual(['running']);
  });
});

// As regras do rede.js que o cérebro espera: o canal fechado fica mudo, e tudo responde num tempo limitado.
test.describe('a rede', () => {
  test('depois do fecharCanal, o canal velho fica mudo', async ({ page }) => {
    await registrar(page);
    const rede = await abrir(page);
    rede.aoPedir = (c) => c.mandar({ tipo: 'aguardando' });
    await pedirParaEntrar(page);
    await expect(titulo(page, 'Aguardando ser aceito…')).toBeVisible();
    const velho = await rede.canalNumero(1);
    await botao(page, 'Desistir').click();
    await expect.poll(() => velho.fechadoPelaPagina).toBe(1000);
    await botao(page, 'Pedir para entrar').click();
    const novo = await rede.canalNumero(2);
    await expect.poll(() => novo.tipos()).toEqual(['pedir']);

    // O fechamento do canal velho chega agora, com o 1011: ouvido, ele abriria de novo 3 s depois.
    await velho.fechar(1011);
    await page.clock.runFor(3_000);
    expect(await abrires(page)).toBe(3);
    await expect(titulo(page, 'Aguardando ser aceito…')).toBeVisible();
    // E o canal novo, que abriu, passa do prazo de abrir sem cair.
    await page.clock.runFor(10_000);
    await expect(titulo(page, 'Aguardando ser aceito…')).toBeVisible();
    expect(novo.fechadoPelaPagina).toBeUndefined();
  });

  test('o abrir sem resposta desiste em 10 s', async ({ page }) => {
    const rede = await abrir(page, { respostas: ['semResposta'] });
    await expect.poll(() => rede.abrires.length).toBe(1);
    const semServidor = titulo(page, 'O servidor de reuniões não respondeu');
    await page.clock.runFor(9_999);
    await expect(semServidor).toBeHidden();
    await page.clock.runFor(1);
    await expect(semServidor).toBeVisible();
  });

  test('o canal que não abre fecha em 10 s', async ({ page }) => {
    const rede = await abrir(page);
    rede.canaisAbrem = false;
    await pedirParaEntrar(page);
    await rede.canalNumero(1);
    const semServidor = titulo(page, 'O servidor de reuniões não respondeu');
    await page.clock.runFor(9_999);
    await expect(titulo(page, 'Aguardando ser aceito…')).toBeVisible();
    await page.clock.runFor(1);
    await expect(semServidor).toBeVisible();
  });

  // Fechado conectando, o WebSocket faz o Chromium escrever no console a URL dele, com o bilhete.
  test('o canal que ainda conecta só fecha quando abre', async ({ page }) => {
    const rede = await preparar(page);
    await gravarFechamentos(page);
    await page.goto(`/r/${CODIGO}`);
    rede.aoPedir = (c) => c.mandar({ tipo: 'aguardando' });

    // O Desistir com o canal abrindo, e um canal novo no lugar dele: o abandonado abre depois, a página o fecha, e
    // nada dele chega ao cérebro.
    rede.canaisAbrem = false;
    await pedirParaEntrar(page);
    const primeiro = await rede.canalNumero(1);
    await botao(page, 'Desistir').click();
    await expect(titulo(page, 'Planejamento de dezembro')).toBeVisible();
    rede.canaisAbrem = true;
    await botao(page, 'Pedir para entrar').click();
    const segundo = await rede.canalNumero(2);
    await expect.poll(() => segundo.tipos()).toEqual(['pedir']);
    primeiro.abrir();
    await expect.poll(() => primeiro.fechadoPelaPagina).toBe(1000);
    expect(primeiro.recebidas).toEqual([]);
    await expect(titulo(page, 'Aguardando ser aceito…')).toBeVisible();

    // O prazo de 10 s do canal que não abre: o mesmo semServidor, e o canal fecha quando abrir.
    await botao(page, 'Desistir').click();
    rede.canaisAbrem = false;
    await botao(page, 'Pedir para entrar').click();
    const terceiro = await rede.canalNumero(3);
    await page.clock.runFor(10_000);
    await expect(titulo(page, 'O servidor de reuniões não respondeu')).toBeVisible();
    terceiro.abrir();
    await expect.poll(() => terceiro.fechadoPelaPagina).toBe(1000);
    expect(terceiro.recebidas).toEqual([]);
    await expect(titulo(page, 'O servidor de reuniões não respondeu')).toBeVisible();

    // Nenhum close() com o canal conectando (0): os três foram com ele aberto (1).
    expect(await fechamentos(page)).toEqual(['bilhete-2 1', 'bilhete-3 1', 'bilhete-4 1']);
  });
});

test('a mídia que chega depois do fim para', async ({ page }) => {
  // O getUserMedia só responde quando o teste solta, e guarda os fluxos que deu.
  await page.addInitScript(() => {
    const w = window as unknown as { soltarMidia: () => void; fluxos: MediaStream[] };
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const solta = new Promise<void>((r) => {
      w.soltarMidia = r;
    });
    w.fluxos = [];
    navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
      await solta;
      const f = await original(c);
      w.fluxos.push(f);
      return f;
    };
  });
  const rede = await abrir(page);
  rede.aoPedir = (c) => c.mandar({ tipo: 'recusado' });
  await pedirParaEntrar(page);
  await expect(titulo(page, 'Não foi possível entrar')).toBeVisible();

  // O pedido da câmera e do microfone responde agora, depois do fim: o fluxo para, e a imagem não aparece.
  await page.evaluate(() => (window as unknown as { soltarMidia: () => void }).soltarMidia());
  const fluxos = () =>
    page.evaluate(() =>
      (window as unknown as { fluxos: MediaStream[] }).fluxos.map((f) => f.getTracks().map((t) => t.readyState)),
    );
  await expect.poll(fluxos).toEqual([['ended', 'ended']]);
  expect(await page.locator('video.previa').first().evaluate((v: HTMLVideoElement) => v.srcObject)).toBeNull();
});

// Uma ligação falsa no lugar do ligacao.js (que ainda não liga): ela confirma, e o teste dá os eventos dela.
const LIGACAO_FALSA = `
export function criarLigacoes(aoEvento) {
  window.ligacaoFalsa = aoEvento;
  return {
    ligar({ qual }) { setTimeout(() => aoEvento({ tipo: 'ligacao', qual, o: 'confirmada' }), 0); },
    desligar() {},
    trocarCamera() { setTimeout(() => aoEvento({ tipo: 'cameraTrocada', ok: true }), 0); },
    trocarMicrofone() {},
  };
}`;

/** A página na reunião, com a ligação falsa (ou outra). */
async function naReuniao(page: Page, ligacao = LIGACAO_FALSA): Promise<RedeFalsa> {
  await page.route('**/r/estatico/ligacao.js', (r) =>
    r.fulfill({ contentType: 'text/javascript; charset=utf-8', body: ligacao }),
  );
  const rede = await abrir(page);
  await esperarAMidia(page);
  rede.aoPedir = (c) => c.mandar(ACEITO);
  await pedirParaEntrar(page);
  await expect(titulo(page, 'Entrando na reunião…')).toBeVisible();
  await page.clock.runFor(10);
  await expect(page.getByRole('navigation', { name: 'Controles da reunião' })).toBeVisible();
  return rede;
}

const darNaLigacao = (page: Page, evento: object) =>
  page.evaluate((e) => (window as unknown as { ligacaoFalsa: (e: object) => void }).ligacaoFalsa(e), evento);

test.describe('a reunião', () => {
  test('na conexão caída, o Sair continua valendo', async ({ page }) => {
    await naReuniao(page);
    await expect(titulo(page, 'Planejamento de dezembro')).toBeFocused();

    await darNaLigacao(page, { tipo: 'ligacao', qual: 'principal', o: 'semConexao' });
    await expect(page.getByRole('heading', { level: 2, name: 'A conexão caiu. Entrando de novo…' })).toBeVisible();
    await expect(
      page.getByText('Espere um instante: a página volta sozinha para a reunião.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('A conexão caiu. Entrando de novo…');
    await expect(botao(page, 'Compartilhar a tela')).toBeDisabled();

    await expect(botao(page, 'Sair')).toBeEnabled();
    await botao(page, 'Sair').click();
    await expect(titulo(page, 'Você saiu da reunião')).toBeVisible();
    await expect(page.getByText('Para voltar, clique em Entrar de novo.', { exact: true })).toBeVisible();
    await expect(botao(page, 'Entrar de novo')).toBeEnabled();
  });

  test('na reunião, a câmera é da ligação', async ({ page }) => {
    await midiaFalsa(page, {});
    await naReuniao(page);
    // A Câmera da reunião vai à ligação (o trocarCamera): a mídia não para a câmera nem a pede de novo.
    await botao(page, 'Câmera').click();
    await page.clock.runFor(10);
    await expect(botao(page, 'Câmera')).toHaveAttribute('aria-pressed', 'false');
    expect(await camerasVivas(page)).toBe(1);
    await botao(page, 'Câmera').click();
    await page.clock.runFor(10);
    await expect(botao(page, 'Câmera')).toHaveAttribute('aria-pressed', 'true');
    expect(await pedidos(page)).toEqual(['audio+video']);
  });

  test('sair da reunião não pede a câmera', async ({ page }) => {
    await midiaFalsa(page, {});
    await naReuniao(page);
    // A Câmera desligada e ligada de novo na reunião vai à ligação, e não à mídia.
    await botao(page, 'Câmera').click();
    await page.clock.runFor(10);
    await botao(page, 'Câmera').click();
    await page.clock.runFor(10);
    await expect(botao(page, 'Câmera')).toHaveAttribute('aria-pressed', 'true');
    // A ligação deixou o fluxo sem câmera viva, com a escolha ligada (a ligação pode trocar a faixa fora dele).
    await page
      .locator('video.previa')
      .first()
      .evaluate((v: HTMLVideoElement) => {
        for (const t of (v.srcObject as MediaStream).getVideoTracks()) t.stop();
      });
    await botao(page, 'Sair').click();
    await expect(titulo(page, 'Você saiu da reunião')).toBeVisible();
    await page.clock.runFor(10);
    // O desenho do saiu vem antes do pararMidia: ele não pede a câmera de novo.
    expect(await pedidos(page)).toEqual(['audio+video']);
  });

  test('o Compartilhar a tela só vale com o canal aberto', async ({ page }) => {
    const rede = await naReuniao(page);
    const compartilhar = botao(page, 'Compartilhar a tela');
    await expect(compartilhar).toBeEnabled();

    // O canal cai com a ligação no ar: ele volta por trás, com a chave, e nada aparece na tela.
    await (await rede.canalNumero(1)).fechar(1001);
    await expect(compartilhar).toBeDisabled();
    await page.clock.runFor(2_000);
    const volta = await rede.canalNumero(2);
    await expect
      .poll(() => volta.recebidas)
      .toEqual([{ tipo: 'voltar', participante: 'participante-1', volta: 'volta-1' }]);
    await expect(compartilhar).toBeDisabled(); // o canal está voltando
    volta.mandar({ tipo: 'voltou', volta: 'volta-2' });
    await expect(compartilhar).toBeEnabled();
    await expect(page.getByRole('heading', { name: 'A conexão caiu. Entrando de novo…' })).toBeHidden();
  });
});

// Uma ligação falsa que trata a câmera como a de verdade: a desligada para e sai do fluxo, e a ligada de novo é pedida
// e entra nele; com o window.cameraPresa, o pedido dela não responde. Cada ligar guarda as câmeras vivas do fluxo
// daquela hora (window.ligares).
const LIGACAO_DA_CAMERA = `
export function criarLigacoes(aoEvento) {
  window.ligacaoFalsa = aoEvento;
  window.ligares = [];
  let fluxo = null;
  return {
    ligar({ qual, fluxo: f }) {
      fluxo = f;
      window.ligares.push(f ? f.getVideoTracks().filter((t) => t.readyState === 'live').length : 0);
      setTimeout(() => aoEvento({ tipo: 'ligacao', qual, o: 'confirmada' }), 0);
    },
    desligar() {},
    trocarCamera(ligada) {
      if (ligada) {
        if (window.cameraPresa) return;
        navigator.mediaDevices.getUserMedia({ video: true }).then((f) => {
          fluxo.addTrack(f.getVideoTracks()[0]);
          aoEvento({ tipo: 'cameraTrocada', ok: true });
        });
        return;
      }
      for (const t of fluxo ? fluxo.getVideoTracks() : []) {
        t.stop();
        fluxo.removeTrack(t);
      }
      setTimeout(() => aoEvento({ tipo: 'cameraTrocada', ok: true }), 0);
    },
    trocarMicrofone() {},
  };
}`;

// A conexão caída devolve a câmera à página até a volta: a Câmera, que só muda o estado, chega ao fluxo pelo midia.js,
// e o ligar da volta lê o fluxo (e espera a câmera pedida, como o R14).
test.describe('a câmera na conexão caída', () => {
  const caiu = (page: Page) => page.getByRole('heading', { level: 2, name: 'A conexão caiu. Entrando de novo…' });
  const ligares = (page: Page) => page.evaluate(() => (window as unknown as { ligares: number[] }).ligares);
  const cameras = (page: Page) =>
    page.evaluate(() => (window as unknown as { cameras: MediaStreamTrack[] }).cameras.map((t) => t.readyState));
  const semConexao = { tipo: 'ligacao', qual: 'principal', o: 'semConexao' };

  /** A volta: depois da espera de 2 s, a página pede a senha pelo canal, e ela chega. */
  async function voltar(page: Page, rede: RedeFalsa): Promise<void> {
    const canal = await rede.canalNumero(1);
    const senhas = () => canal.tipos().filter((t) => t === 'senha').length;
    const antes = senhas();
    await page.clock.runFor(2_000);
    await expect.poll(senhas).toBe(antes + 1);
    canal.mandar({ tipo: 'senha', senha: 'senha-2' });
  }

  test('desligada, ela para, e a volta sai sem ela', async ({ page }) => {
    await midiaFalsa(page, {});
    const rede = await naReuniao(page, LIGACAO_DA_CAMERA);
    await darNaLigacao(page, semConexao);
    await expect(caiu(page)).toBeVisible();

    await botao(page, 'Câmera').click();
    await expect(botao(page, 'Câmera')).toHaveAttribute('aria-pressed', 'false');
    expect(await cameras(page)).toEqual(['ended']);
    expect(await camerasVivas(page)).toBe(0);

    await voltar(page, rede);
    await expect.poll(() => ligares(page)).toEqual([1, 0]);
    await page.clock.runFor(10);
    await expect(caiu(page)).toBeHidden();
    await expect(botao(page, 'Câmera')).toHaveAttribute('aria-pressed', 'false');
    expect(await pedidos(page)).toEqual(['audio+video']);
  });

  test('ligada de novo, ela é pedida sozinha, e a volta a espera', async ({ page }) => {
    await midiaFalsa(page, {});
    const rede = await naReuniao(page, LIGACAO_DA_CAMERA);
    await botao(page, 'Câmera').click();
    await page.clock.runFor(10);
    await expect(botao(page, 'Câmera')).toHaveAttribute('aria-pressed', 'false');
    await darNaLigacao(page, semConexao);
    await expect(caiu(page)).toBeVisible();

    // O pedido só da câmera fica segurado até depois da senha da volta.
    await page.evaluate(() => {
      (window as unknown as { seguraCamera: boolean }).seguraCamera = true;
    });
    await botao(page, 'Câmera').click();
    await expect(botao(page, 'Câmera')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => pedidos(page)).toEqual(['audio+video', 'video']);
    await voltar(page, rede);
    await page.clock.runFor(1_000);
    expect(await ligares(page)).toEqual([1]);

    await page.evaluate(() => (window as unknown as { soltarCamera: () => void }).soltarCamera());
    await expect.poll(() => ligares(page)).toEqual([1, 1]);
    await page.clock.runFor(10);
    await expect(caiu(page)).toBeHidden();
    expect(await camerasVivas(page)).toBe(1);
  });

  test('a câmera que a ligação ainda pedia é pedida de novo', async ({ page }) => {
    await midiaFalsa(page, {});
    const rede = await naReuniao(page, LIGACAO_DA_CAMERA);
    await botao(page, 'Câmera').click();
    await page.clock.runFor(10);
    await expect(botao(page, 'Câmera')).toHaveAttribute('aria-pressed', 'false');
    // Ligada de novo, a ligação ainda a pede (o trocarCamera sem resposta) quando a conexão cai.
    await page.evaluate(() => {
      (window as unknown as { cameraPresa: boolean }).cameraPresa = true;
    });
    await botao(page, 'Câmera').click();
    await expect(botao(page, 'Câmera')).toHaveAttribute('aria-pressed', 'true');
    await darNaLigacao(page, semConexao);
    await expect(caiu(page)).toBeVisible();

    await expect.poll(() => pedidos(page)).toEqual(['audio+video', 'video']);
    await expect.poll(() => camerasVivas(page)).toBe(1);
    await voltar(page, rede);
    await expect.poll(() => ligares(page)).toEqual([1, 1]);
    await page.clock.runFor(10);
    await expect(caiu(page)).toBeHidden();
    await expect(botao(page, 'Câmera')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a câmera que a ligação pôs no fluxo e que acaba sozinha passa a faltar', async ({ page }) => {
    await midiaFalsa(page, {});
    await naReuniao(page, LIGACAO_DA_CAMERA);
    // Desligada e ligada de novo na reunião: a câmera nova é da ligação, que a pôs no fluxo.
    await botao(page, 'Câmera').click();
    await page.clock.runFor(10);
    await expect(botao(page, 'Câmera')).toHaveAttribute('aria-pressed', 'false');
    await botao(page, 'Câmera').click();
    await expect.poll(() => camerasVivas(page)).toBe(1);
    await expect.poll(() => pedidos(page)).toEqual(['audio+video', 'video']);
    await darNaLigacao(page, semConexao);
    await expect(caiu(page)).toBeVisible();

    // Na conexão caída, ela acaba sozinha: sai do fluxo, e a câmera passa a faltar.
    await page
      .locator('video.previa')
      .first()
      .evaluate((v: HTMLVideoElement) => {
        const [faixa] = (v.srcObject as MediaStream).getVideoTracks();
        faixa.stop();
        faixa.dispatchEvent(new Event('ended'));
      });
    await expect(botao(page, 'Câmera')).toBeDisabled();
    const naPrevia = (v: HTMLVideoElement) => (v.srcObject as MediaStream).getVideoTracks().length;
    expect(await page.locator('video.previa').first().evaluate(naPrevia)).toBe(0);
  });
});

test.describe(() => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('no celular', async ({ page }) => {
    await abrir(page);
    await page.getByLabel('Seu nome').fill('Maria Lima');

    const cabeca = await caixa(titulo(page, 'Planejamento de dezembro'));
    const imagem = await caixa(page.locator('video.previa').first());
    const mic = await caixa(botao(page, 'Microfone'));
    const cam = await caixa(botao(page, 'Câmera'));
    const campo = await caixa(page.getByLabel('Seu nome'));
    const pedir = await caixa(botao(page, 'Pedir para entrar'));

    // Uma coluna: o título, a imagem, os botões, o campo e o Pedir, um embaixo do outro, com a mesma largura.
    expect(cabeca.y + cabeca.height).toBeLessThanOrEqual(imagem.y);
    expect(imagem.y + imagem.height).toBeLessThanOrEqual(mic.y);
    expect(mic.y + mic.height).toBeLessThanOrEqual(campo.y);
    expect(campo.y + campo.height).toBeLessThanOrEqual(pedir.y);
    expect(Math.abs(imagem.x - campo.x)).toBeLessThan(1);
    expect(Math.abs(imagem.width - campo.width)).toBeLessThan(1);
    // Os dois botões lado a lado.
    expect(Math.abs(mic.y - cam.y)).toBeLessThan(1);
    expect(mic.x + mic.width).toBeLessThanOrEqual(cam.x);
    // O Pedir para entrar na largura toda.
    expect(Math.abs(pedir.x - campo.x)).toBeLessThan(1);
    expect(Math.abs(pedir.width - campo.width)).toBeLessThan(1);
    expect(pedir.width).toBeGreaterThan(340);
    // Nada passa da largura da tela.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test('o título comprido no celular', async ({ page }) => {
    // 120 caracteres sem espaço (um código, um nome com sublinhado): ele quebra, e nada passa da largura da tela.
    const longo = 'PlanejamentoDoAno'.repeat(7) + 'X';
    expect(longo).toHaveLength(120);
    const largura = () => page.evaluate(() => document.documentElement.scrollWidth);
    await page.route('**/r/estatico/ligacao.js', (r) =>
      r.fulfill({ contentType: 'text/javascript; charset=utf-8', body: LIGACAO_FALSA }),
    );
    const rede = await abrir(page, { reuniao: { ...MARCADA, assunto: longo } });
    await expect(titulo(page, longo)).toBeVisible();
    expect(await largura()).toBeLessThanOrEqual(390);

    rede.aoPedir = (c) => c.mandar({ tipo: 'aguardando' });
    await pedirParaEntrar(page);
    await expect(titulo(page, 'Aguardando ser aceito…')).toBeVisible();
    expect(await largura()).toBeLessThanOrEqual(390);

    (await rede.canalNumero(1)).mandar(ACEITO);
    await expect(titulo(page, 'Entrando na reunião…')).toBeVisible();
    await page.clock.runFor(10);
    await expect(titulo(page, longo)).toBeVisible();
    expect(await largura()).toBeLessThanOrEqual(390);
  });
});

// O Compartilhar a tela é só do PC: na tela de toque ele não aparece, nem com o celular deitado, que passa dos 600 px
// de largura. A janela do PC do mesmo tamanho tem o botão.
const botoesDaReuniao = (page: Page) =>
  page.getByRole('navigation', { name: 'Controles da reunião' }).getByRole('button');

test.describe(() => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });

  test('o celular deitado, sem o Compartilhar a tela', async ({ page }) => {
    await naReuniao(page);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    expect(await page.evaluate(() => typeof navigator.mediaDevices.getDisplayMedia)).toBe('function');
    await expect(botoesDaReuniao(page)).toHaveText(['Microfone', 'Câmera', 'Chat', 'Sair']);
    await expect(botao(page, 'Compartilhar a tela')).toBeHidden();
  });
});

test.describe(() => {
  test.use({ viewport: { width: 844, height: 390 } });

  test('a janela do PC do tamanho do celular deitado, com o Compartilhar a tela', async ({ page }) => {
    await naReuniao(page);
    await expect(botoesDaReuniao(page)).toHaveText(['Microfone', 'Câmera', 'Compartilhar a tela', 'Chat', 'Sair']);
  });
});

test('os cabeçalhos da página', async ({ page }) => {
  const erros: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || /Content.Security.Policy|Refused to/i.test(m.text())) erros.push(m.text());
  });
  page.on('pageerror', (e) => erros.push(e.message));
  await page.addInitScript(() => {
    const w = window as unknown as { violacoes: string[] };
    w.violacoes = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.violacoes.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  const rede = await preparar(page);
  rede.aoPedir = (c) => c.mandar({ tipo: 'aguardando' });

  const resposta = await page.goto(`/r/${CODIGO}`);
  const canalDoChat = CHAT.replace(/^http/, 'ws');
  expect(resposta?.headers()['content-security-policy']).toBe(
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; font-src 'self'; " +
      `connect-src 'self' ${canalDoChat}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
  );

  // Do começo ao fim da entrada: a mídia, o nome, o Pedir e a espera.
  await esperarAMidia(page);
  await pedirParaEntrar(page);
  await expect(titulo(page, 'Aguardando ser aceito…')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { violacoes: string[] }).violacoes)).toEqual([]);
  expect(erros).toEqual([]);
});
