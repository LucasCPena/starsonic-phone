// As telas da página da reunião, no Chromium: a página de verdade, servida pelo chat no modo de teste, com a rede
// falsa (o abrir e o canal) e o relógio fixo. O relógio fica parado: os prazos da página só andam pelo runFor.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { CHAT } from '../chat';
import { CODIGO, RedeFalsa, type Mensagem, type Reuniao, type RespostaDoAbrir } from '../rede-falsa';

/** Hoje, 17/11/2026, às 10:00 em São Paulo (o fuso dos testes). */
const AGORA = new Date('2026-11-17T10:00:00-03:00').getTime();

const MARCADA: Reuniao = {
  tipo: 'marcada',
  assunto: 'Planejamento de dezembro',
  inicio: new Date('2026-11-17T14:00:00-03:00').getTime(),
};

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
 * 'video') e de cada faixa de câmera que eles deram (window.cameras), e os erros e as permissões do teste.
 */
async function midiaFalsa(page: Page, opcoes: MidiaFalsa): Promise<void> {
  await page.addInitScript((opcoes) => {
    const w = window as unknown as { pedidos: string[]; cameras: MediaStreamTrack[]; erros: Record<string, string> };
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    w.pedidos = [];
    w.cameras = [];
    w.erros = { ...opcoes.erros };
    navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
      w.pedidos.push([c?.audio && 'audio', c?.video && 'video'].filter(Boolean).join('+'));
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

/** As faixas de câmera vivas no fluxo da prévia da entrada. */
const camerasVivas = (page: Page) =>
  page
    .locator('video.previa')
    .first()
    .evaluate((v: HTMLVideoElement) =>
      (v.srcObject as MediaStream | null)?.getVideoTracks().filter((t) => t.readyState === 'live').length ?? 0,
    );

/**
 * O registro da página, na ordem: cada play() de um elemento de mídia e cada fetch, com o evento que o browser
 * despachava naquela hora (window.event), ou "-" fora de um evento.
 */
async function registrar(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { registro: string[] };
    w.registro = [];
    const evento = () => window.event?.type ?? '-';
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      w.registro.push(`play #${this.id} ${evento()}`);
      return play.call(this);
    };
    const buscar = window.fetch;
    window.fetch = function (entrada: RequestInfo | URL, init?: RequestInit) {
      const url = entrada instanceof Request ? entrada.url : String(entrada);
      w.registro.push(`fetch ${new URL(url, location.href).pathname} ${evento()}`);
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

test('o primeiro play nasce no clique', async ({ page }) => {
  await registrar(page);
  await abrir(page);
  await page.getByLabel('Seu nome').fill('Maria Lima');
  const antes = (await registro(page)).length;

  await botao(page, 'Pedir para entrar').click();

  // Dentro do clique (o window.event é ele), o play() do #som vem antes do abrir, o primeiro pedido de rede. E é o
  // primeiro play() da página: antes do clique, nenhum.
  await expect.poll(async () => (await registro(page)).slice(antes, antes + 2)).toEqual([
    'play #som click',
    `fetch /api/v1/pagina/reunioes/${CODIGO} click`,
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

  await nome.press('Enter');
  await expect.poll(async () => (await registro(page)).slice(antes, antes + 2)).toEqual([
    'play #som click',
    `fetch /api/v1/pagina/reunioes/${CODIGO} click`,
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

  // A ligação desta tarefa não liga: a resposta dela (o falhou) sai no próximo passo do relógio.
  await page.clock.runFor(10);
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

/** A página na reunião, com a ligação falsa. */
async function naReuniao(page: Page): Promise<RedeFalsa> {
  await page.route('**/r/estatico/ligacao.js', (r) =>
    r.fulfill({ contentType: 'text/javascript; charset=utf-8', body: LIGACAO_FALSA }),
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
