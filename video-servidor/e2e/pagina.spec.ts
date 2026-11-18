// A página da reunião de ponta a ponta: a página de verdade, servida pelo chat em /r/<código>, com as ligações do JsSIP
// ao agente e ao FreeSWITCH. Cada navegador é uma pessoa, com a câmera de uma cor e o microfone de um tom (midia.ts); o
// mosaico e o som são lidos do #mosaico e do #som da página (navegador.ts). A colega da empresa entra pelo cliente
// mínimo, com o Acesso do entrar do app.
import { expect, test } from '@playwright/test';
import { repetirAte } from './espera';
import {
  A,
  AMARELO,
  AZUL,
  B,
  C,
  combinam,
  MOSAICO_1,
  MOSAICO_2,
  perto,
  PESSOAS_2,
  TELA_2,
  VERDE,
  VERMELHO,
  type Cor,
} from './midia';
import { Navegador, Pagina, telaVerde } from './navegador';
import {
  ana,
  ligacoesPrincipais,
  novaReuniaoDeTeste,
  salaDaSenha,
  salaNoAgente,
  type Computador,
  type EventosDoApp,
} from './servidores';

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** O quadro de quem está sem câmera (seção 7 do docs/video-agente.md). */
const SEM_CAMERA: Cor = [0x1b, 0x23, 0x33];

/**
 * Espera, no mosaico de 2, a cor da outra pessoa e o quadro de quem está sem câmera: o #1B2333, com a tolerância do
 * midia.ts, e mais claro que o fundo do mosaico (#04060E) e que o preto, que também estão a 60 dele. O quadro sem
 * imagem fica com o fundo por 5 s, até o FreeSWITCH pôr o quadro sem câmera.
 */
async function esperarSemCamera(quem: Navegador | Pagina, outra: Cor, prazo = 20_000): Promise<void> {
  const claro = (c: Cor | null) => c !== null && perto(c, SEM_CAMERA) && Math.max(...c) >= 35;
  await repetirAte(
    prazo,
    250,
    () => quem.amostras(MOSAICO_2),
    (vistas) => combinam(vistas, [outra, SEM_CAMERA]) && vistas.some(claro),
    (vistas) =>
      `o quadro sem câmera não apareceu no vídeo de ${quem.pessoa.letra} em ${prazo / 1000} s; ` +
      `as últimas vistas: ${JSON.stringify(vistas)}`,
  );
}

test('a reunião de teste pela página', async () => {
  const codigo = await novaReuniaoDeTeste();
  let a: Pagina | undefined;
  let b: Pagina | undefined;
  try {
    a = await Pagina.abrir(A);
    b = await Pagina.abrir(B);
    // Na reunião de teste, o pedir responde aceito na hora: as duas entram sem a espera.
    await a.entrar(codigo, 'Carlos Lima');
    await b.entrar(codigo, 'Bia Ramos');

    // O mosaico de 2 tem o vermelho e o azul, em qualquer ordem, nas duas páginas; cada uma ouve a outra.
    await a.esperarCores(MOSAICO_2, [VERMELHO, AZUL]);
    await b.esperarCores(MOSAICO_2, [VERMELHO, AZUL]);
    await b.esperarFrequencia(A.som);
    await a.esperarFrequencia(B.som);

    // O WSS do vídeo passou pela CSP, e o console não tem segredo nem erro.
    await a.conferirOConsole();
    await b.conferirOConsole();
  } finally {
    await a?.fechar();
    await b?.fechar();
  }
});

// A câmera desligada é o vídeo sem imagem (o desenho, item 5, com o vídeo nos dois sentidos: o ligacao.js diz por quê):
// o FreeSWITCH mostra o quadro de quem está sem câmera, e o RTCP e o ICE do caminho do vídeo seguram a ligação além do
// tempo sem mídia (60 s).
test('a câmera desligada por 70 segundos', async () => {
  test.setTimeout(180_000);
  const codigo = await novaReuniaoDeTeste();
  let colega: Navegador | undefined;
  let maria: Pagina | undefined;
  try {
    colega = await Navegador.abrir(A);
    await colega.entrarPelaPagina(codigo, 'Carlos Lima');
    maria = await Pagina.abrir(C);
    await maria.entrar(codigo, 'Maria Lima');
    await colega.esperarCores(MOSAICO_2, [VERMELHO, AMARELO]);

    // Maria desliga a câmera: em até 10 s, o quadro dela tem a cor de quem está sem câmera, e a câmera parou.
    const camera = maria.controles().getByRole('button', { name: 'Câmera', exact: true });
    await camera.click();
    await expect(camera).toHaveAttribute('aria-pressed', 'false');
    await esperarSemCamera(colega, VERMELHO, 10_000);
    await esperarSemCamera(maria, VERMELHO, 10_000);
    expect(await maria.camerasNoFluxo(), 'a câmera da Maria parou e saiu do fluxo').toEqual({ todas: 0, vivas: 0 });
    expect(await maria.camerasVivas(), 'as câmeras vivas na página da Maria (a luz)').toBe(0);

    // 70 s depois, ela continua na reunião: o canal não recebeu nada, e a ligação não terminou.
    const recebidas = maria.mensagensRecebidas().length;
    await esperar(70_000);
    expect(maria.mensagensRecebidas().length, 'as mensagens que o canal da Maria recebeu').toBe(recebidas);
    await expect(maria.controles()).toBeVisible();
    expect(await ligacoesPrincipais(maria.participante()), 'as ligações da Maria no agente').toBe(1);
    await esperarSemCamera(colega, VERMELHO);

    // Ela liga a câmera, e a cor dela volta; a câmera nova está no fluxo da página.
    await camera.click();
    await expect(camera).toHaveAttribute('aria-pressed', 'true');
    await colega.esperarCores(MOSAICO_2, [VERMELHO, AMARELO]);
    await maria.esperarCores(MOSAICO_2, [VERMELHO, AMARELO]);
    expect(await maria.camerasNoFluxo(), 'a câmera nova da Maria no fluxo').toEqual({ todas: 1, vivas: 1 });
    expect(await maria.camerasVivas(), 'as câmeras vivas na página da Maria').toBe(1);
    await maria.conferirOConsole();
  } finally {
    await maria?.fechar();
    await colega?.fechar();
  }
});

// Quem entra só para ver e ouvir (sem microfone, e com a câmera desligada na entrada): o quadro dela é o de quem está
// sem câmera, e a ligação manda o silêncio gerado (o desenho, item 6). Um destino vazio, ou o de um contexto de som
// parado, não mandaria RTP, e a ligação cairia pelo tempo sem mídia.
test('só para ver e ouvir, sem microfone e sem câmera', async () => {
  const codigo = await novaReuniaoDeTeste();
  let colega: Navegador | undefined;
  let maria: Pagina | undefined;
  try {
    colega = await Navegador.abrir(A);
    await colega.entrarPelaPagina(codigo, 'Carlos Lima');
    maria = await Pagina.abrir(C, { semMicrofone: true });
    await maria.entrar(codigo, 'Maria Lima', { cameraDesligada: true });
    await expect(maria.controles()).toBeVisible({ timeout: 30_000 });
    await expect(maria.controles().getByRole('button', { name: 'Microfone', exact: true })).toBeDisabled();
    await esperarSemCamera(colega, VERMELHO);
    await esperarSemCamera(maria, VERMELHO);
    expect(await maria.camerasNoFluxo(), 'a câmera da Maria').toEqual({ todas: 0, vivas: 0 });
    expect(await maria.camerasVivas(), 'as câmeras vivas na página da Maria (a luz)').toBe(0);

    // O som sai: 20 ms por pacote dão 50 pacotes por segundo.
    const antes = await maria.pacotesDeSomMandados();
    await esperar(2_000);
    expect(await maria.pacotesDeSomMandados(), 'os pacotes de som mandados em 2 s').toBeGreaterThan(antes + 50);
    await maria.conferirOConsole();
  } finally {
    await maria?.fechar();
    await colega?.fechar();
  }
});

// O aparelho que acaba sozinho na reunião (desligado da USB, tomado por outro programa): a ligação segue sozinha. A
// câmera vai ao quadro de quem está sem câmera, e o silêncio toma o lugar do microfone, para o RTP continuar.
test('o aparelho que acaba sozinho na reunião', async () => {
  const codigo = await novaReuniaoDeTeste();
  let colega: Navegador | undefined;
  let maria: Pagina | undefined;
  try {
    colega = await Navegador.abrir(A);
    await colega.entrarPelaPagina(codigo, 'Carlos Lima');
    maria = await Pagina.abrir(C);
    await maria.entrar(codigo, 'Maria Lima');
    await colega.esperarCores(MOSAICO_2, [VERMELHO, AMARELO]);

    // A câmera desligada e ligada de novo na reunião é a da ligação, que o midia.js não vigia. A cor da Maria de volta
    // no mosaico da colega diz que a troca acabou.
    const camera = maria.controles().getByRole('button', { name: 'Câmera', exact: true });
    await camera.click();
    await expect(camera).toHaveAttribute('aria-pressed', 'false');
    await esperarSemCamera(colega, VERMELHO, 10_000);
    await camera.click();
    await expect(camera).toHaveAttribute('aria-pressed', 'true');
    await colega.esperarMosaicoDe2([VERMELHO, AMARELO]);

    // Ela acaba sozinha: a Câmera passa a faltar, e o quadro da Maria é o de quem está sem câmera.
    await maria.acabarSozinha('video');
    await expect(camera).toBeDisabled();
    await esperarSemCamera(colega, VERMELHO, 10_000);

    await maria.acabarSozinha('audio');
    await expect(maria.controles().getByRole('button', { name: 'Microfone', exact: true })).toBeDisabled();
    const antes = await maria.pacotesDeSomMandados();
    await esperar(2_000);
    expect(await maria.pacotesDeSomMandados(), 'os pacotes de som mandados em 2 s').toBeGreaterThan(antes + 50);
    await expect(maria.controles()).toBeVisible();
    await maria.conferirOConsole();
  } finally {
    await maria?.fechar();
    await colega?.fechar();
  }
});

// A tela compartilhada pela página (o desenho, item 4): o clique no Compartilhar a tela pede a tela (aqui, o canvas
// verde), e a segunda ligação da Maria a manda, com o silêncio gerado, só para mandar. O agente põe a apresentação de 2
// (seção 7 do docs/video-agente.md), de 1920×1620: a tela em cima, e as duas pessoas embaixo; quando ela sai, a grade
// de 1920×1080 volta.
test.describe.serial('a tela compartilhada pela página', () => {
  let colega: Navegador | undefined;
  let maria: Pagina | undefined;

  test.afterAll(async () => {
    await maria?.fechar();
    await colega?.fechar();
  });

  const compartilhando = (p: Pagina) => p.page.getByText('Você está compartilhando a tela', { exact: true });
  /** O estado da faixa de cada tela que a página pediu, na ordem. */
  const telas = (p: Pagina) =>
    p.page.evaluate(() =>
      (window as unknown as { telasDoTeste: MediaStreamTrack[] }).telasDoTeste.map((t) => t.readyState),
    );

  /** Maria compartilha: o selo aparece, e o mosaico é a apresentação de 2, com a tela verde e as duas embaixo. */
  async function compartilhar(m: Pagina, c: Navegador): Promise<void> {
    await m.botao('Compartilhar a tela').click();
    await expect(compartilhando(m)).toBeVisible({ timeout: 20_000 });
    await c.esperarTamanho(1920, 1620);
    await c.esperarCores([TELA_2], [VERDE]);
    await c.esperarCores(PESSOAS_2, [VERMELHO, AMARELO]);
    await m.esperarTamanho(1920, 1620);
    await m.esperarCores([TELA_2], [VERDE]);
    // Na página dela, o quadro grande é o da tela dela, com o verde.
    await m.esperarQuadros(['A sua tela', 'Carlos Lima', 'Você']);
    await expect(m.quadro('A sua tela')).toHaveAttribute('data-papel', 'grande');
    await expect
      .poll(async () => perto(await m.corDoQuadro('A sua tela'), VERDE), { message: 'o verde no quadro A sua tela' })
      .toBe(true);
  }

  /** A tela saiu: a grade volta ao mosaico de 2, o selo some, a captura parou, e o Compartilhar a tela volta. */
  async function aGradeVolta(m: Pagina, c: Navegador): Promise<void> {
    await c.esperarTamanho(1920, 1080);
    await c.esperarMosaicoDe2([VERMELHO, AMARELO]);
    await m.esperarTamanho(1920, 1080);
    await m.esperarQuadros(['Carlos Lima', 'Você']);
    await expect(compartilhando(m)).toBeHidden();
    await expect(m.botao('Compartilhar a tela')).toBeEnabled();
    await expect.poll(() => telas(m), { message: 'as telas que a página pediu' }).not.toContain('live');
    await expect(m.controles()).toBeVisible();
  }

  test('compartilhar a tela pela página', async () => {
    const codigo = await novaReuniaoDeTeste();
    colega = await Navegador.abrir(A);
    await colega.entrarPelaPagina(codigo, 'Carlos Lima');
    maria = await Pagina.abrir(C);
    await maria.page.addInitScript(telaVerde);
    await maria.entrar(codigo, 'Maria Lima');
    await colega.esperarCores(MOSAICO_2, [VERMELHO, AMARELO]);

    await compartilhar(maria, colega);
    // A ligação da tela manda o silêncio gerado: o som dela sai (20 ms por pacote dão 50 pacotes por segundo).
    const antes = await maria.pacotesDeSomMandados();
    await esperar(2_000);
    expect(await maria.pacotesDeSomMandados(), 'os pacotes de som da tela em 2 s').toBeGreaterThan(antes + 50);

    await maria.botao('Parar de compartilhar').click();
    await aGradeVolta(maria, colega);
    expect(await telas(maria)).toEqual(['ended']);
    await maria.conferirOConsole();
  });

  test('a tela que o navegador para', async () => {
    if (!maria || !colega) throw new Error('o teste anterior não pôs a Maria na reunião');
    await compartilhar(maria, colega);

    // O "Parar de compartilhar" do navegador faz o mesmo que o da página.
    await maria.page.evaluate(() => (window as unknown as { oNavegadorParaATela: () => void }).oNavegadorParaATela());
    await aGradeVolta(maria, colega);
    expect(await telas(maria)).toEqual(['ended', 'ended']);
    await maria.conferirOConsole();
  });
});

// Onde o navegador não tem a captura da tela, o Compartilhar a tela não existe.
test('sem captura de tela, sem o botão', async () => {
  const codigo = await novaReuniaoDeTeste();
  let maria: Pagina | undefined;
  try {
    maria = await Pagina.abrir(C);
    await maria.page.addInitScript(() => {
      delete (MediaDevices.prototype as { getDisplayMedia?: unknown }).getDisplayMedia;
    });
    await maria.entrar(codigo, 'Maria Lima');
    await maria.esperarCores(MOSAICO_1, [AMARELO]);
    await expect(maria.controles().getByRole('button')).toHaveText(['Microfone', 'Câmera', 'Sair']);
    await expect(maria.botao('Compartilhar a tela')).toBeHidden();
    await maria.conferirOConsole();
  } finally {
    await maria?.fechar();
  }
});

test('o celular na reunião', async () => {
  const codigo = await novaReuniaoDeTeste();
  let maria: Pagina | undefined;
  try {
    maria = await Pagina.abrir(C, { celular: true });
    await maria.entrar(codigo, 'Maria Lima');
    await maria.esperarCores(MOSAICO_1, [AMARELO]);
    // Os três controles, sem o Compartilhar a tela.
    await expect(maria.controles().getByRole('button')).toHaveText(['Microfone', 'Câmera', 'Sair']);
    await expect(maria.botao('Compartilhar a tela')).toBeHidden();
    await maria.conferirOConsole();
  } finally {
    await maria?.fechar();
  }
});

// A reunião marcada, com a colega (a Ana, pelo app e o cliente mínimo) e a Maria, de fora, pela página. O canal e o
// WSS do vídeo da Maria passam pelas rotas do teste, que os derrubam nos dois últimos.
test.describe.serial('quem é de fora entra pela página', () => {
  let codigo = '';
  let app: Computador | undefined;
  let eventos: EventosDoApp | undefined;
  let colega: Navegador | undefined;
  let maria: Pagina | undefined;

  /** Os pedidos da reunião que chegaram ao app da colega. */
  const pedidos = () => eventos?.todos((e) => e.tipo === 'reuniaoPedido' && e.reuniao === codigo).length ?? 0;

  test.afterAll(async () => {
    eventos?.fechar();
    await maria?.fechar();
    await colega?.fechar();
  });

  test('a pessoa de fora entra pela página', async () => {
    app = ana();
    codigo = await app.criarMarcada();
    eventos = await app.eventos();

    // A colega entra pelo cliente mínimo, com o Acesso do entrar do app: a reunião começa.
    const acesso = await app.entrar(codigo);
    colega = await Navegador.abrir(A);
    await colega.ligar(acesso);
    await colega.esperarCores(MOSAICO_1, [VERMELHO]);

    // Maria pede pela página e espera.
    maria = await Pagina.abrir(C, { derrubavel: true });
    await maria.entrar(codigo, 'Maria Lima');
    await expect(maria.titulo('Aguardando ser aceito…')).toBeVisible();

    // A colega aceita, e a cor de Maria aparece no mosaico; cada uma ouve a outra.
    const pedido = await eventos.esperar(
      (e) => e.tipo === 'reuniaoPedido' && e.reuniao === codigo && e.pedido?.nome === 'Maria Lima',
    );
    await app.aceitar(codigo, pedido.pedido.id);
    await colega.esperarCores(MOSAICO_2, [VERMELHO, AMARELO]);
    await maria.esperarCores(MOSAICO_2, [VERMELHO, AMARELO]);
    await maria.esperarFrequencia(A.som);
    await colega.esperarFrequencia(C.som);
  });

  test('sair e entrar de novo', async () => {
    if (!maria || !colega) throw new Error('o teste anterior não pôs a Maria na reunião');
    const antes = pedidos();

    const sala = salaDaSenha(
      maria.mensagensRecebidas().find((m) => m.tipo === 'aceito')?.senha ?? '',
    );
    const tiposDesde = (n: number) =>
      maria!
        .mensagensRecebidas()
        .slice(n)
        .map((m) => m.tipo);

    // O Sair manda o BYE: a ligação dela sai do mosaico da colega, e o palco da sala, no agente, fica só com a colega.
    const noSair = maria.mensagensRecebidas().length;
    await maria.controles().getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(maria.titulo('Você saiu da reunião')).toBeVisible();
    await colega.esperarCores(MOSAICO_1, [VERMELHO]);
    await expect
      .poll(async () => (await salaNoAgente(sala))?.palco?.quadros.length, { message: 'o palco da sala sem a Maria' })
      .toBe(1);
    // Fora da reunião, a página não recebe o palco: nem esse, nem nenhum outro.
    const fora = tiposDesde(noSair);
    expect(fora.filter((tipo) => tipo === 'palco'), `os palcos entre o Sair e o Entrar de novo (${fora})`).toEqual([]);

    // O Entrar de novo pede uma senha pelo canal, que ficou aberto, e volta ao mosaico sem a espera. Com a resposta da
    // senha vem o palco da sala, em qualquer ordem; nada da sala de espera (nem o aguardando, nem o aceito).
    const recebidas = maria.mensagensRecebidas().length;
    await maria.botao('Entrar de novo').click();
    await expect(maria.controles()).toBeVisible({ timeout: 30_000 });
    await colega.esperarCores(MOSAICO_2, [VERMELHO, AMARELO]);
    await maria.esperarCores(MOSAICO_2, [VERMELHO, AMARELO]);
    await expect.poll(() => tiposDesde(recebidas), { message: 'o palco depois do Entrar de novo' }).toContain('palco');
    const depois = tiposDesde(recebidas);
    expect(depois.filter((tipo) => tipo !== 'palco'), 'o que veio com o palco').toEqual(['senha']);
    expect(pedidos(), 'os pedidos que chegaram à colega').toBe(antes);
  });

  test('a conexão do vídeo cai', async () => {
    if (!maria || !colega) throw new Error('o teste anterior não pôs a Maria na reunião');

    // A câmera desligada e ligada de novo na reunião é outra faixa, que a ligação pôs no fluxo da página. A cor da
    // Maria de volta no mosaico da colega diz que a troca acabou.
    const camera = maria.controles().getByRole('button', { name: 'Câmera', exact: true });
    await camera.click();
    await expect(camera).toHaveAttribute('aria-pressed', 'false');
    await esperarSemCamera(colega, VERMELHO, 10_000);
    await camera.click();
    await expect(camera).toHaveAttribute('aria-pressed', 'true');
    await colega.esperarMosaicoDe2([VERMELHO, AMARELO]);

    // O WSS do vídeo cai para a página: ela avisa e volta sozinha, com uma senha nova pelo canal, e a ligação nova
    // manda a câmera de agora.
    await maria.derrubarOVideo();
    await expect(maria.caiu()).toBeVisible();
    await expect(maria.caiu()).toBeHidden({ timeout: 30_000 });
    await expect(maria.controles()).toBeVisible();
    await colega.esperarMosaicoDe2([VERMELHO, AMARELO]);
    await maria.esperarCores(MOSAICO_2, [VERMELHO, AMARELO]);
    expect(await maria.camerasNoFluxo(), 'a câmera da Maria no fluxo').toEqual({ todas: 1, vivas: 1 });
    expect(await maria.camerasVivas(), 'as câmeras vivas na página da Maria').toBe(1);

    // A ligação principal nova tomou o lugar da anterior no agente (seção 6 do contrato).
    await expect.poll(() => ligacoesPrincipais(maria!.participante()), { timeout: 20_000 }).toBe(1);
  });

  // A câmera ligada de novo logo antes de a conexão cair: o pedido dela ainda corre quando a ligação desce. Na conexão
  // caída, a câmera volta a ser da página, que a pede outra vez, e a volta sai com ela; a faixa que chegou tarde para.
  test('a câmera ligada quando a conexão cai', async () => {
    if (!maria || !colega) throw new Error('o teste anterior não pôs a Maria na reunião');
    const camera = maria.controles().getByRole('button', { name: 'Câmera', exact: true });
    await camera.click();
    await expect(camera).toHaveAttribute('aria-pressed', 'false');
    await esperarSemCamera(colega, VERMELHO, 10_000);

    await maria.segurarACamera();
    await camera.click();
    await expect(camera).toHaveAttribute('aria-pressed', 'true');
    await maria.derrubarOVideo();
    await expect(maria.caiu()).toBeVisible();
    await expect(maria.caiu()).toBeHidden({ timeout: 30_000 });
    await colega.esperarMosaicoDe2([VERMELHO, AMARELO]);
    await maria.esperarCores(MOSAICO_2, [VERMELHO, AMARELO]);
    await expect(camera).toHaveAttribute('aria-pressed', 'true');

    await maria.soltarACamera();
    await expect.poll(() => maria!.cameraSegurada(), { message: 'a câmera que chegou depois da queda' }).toBe('ended');
    expect(await maria.camerasNoFluxo(), 'a câmera da Maria no fluxo').toEqual({ todas: 1, vivas: 1 });
    expect(await maria.camerasVivas(), 'as câmeras vivas na página da Maria').toBe(1);
    await expect.poll(() => ligacoesPrincipais(maria!.participante()), { timeout: 20_000 }).toBe(1);
  });

  // Review Focus 2: o celular que troca do Wi-Fi para o 4G perde as duas conexões juntas. A página volta com a chave,
  // sem a sala de espera.
  test('as duas conexões caem e a página volta sozinha', async () => {
    if (!maria || !colega) throw new Error('o teste anterior não pôs a Maria na reunião');
    const antes = pedidos();
    const mandadas = maria.mensagensMandadas().length;

    await Promise.all([maria.derrubarOCanal(), maria.derrubarOVideo()]);
    await expect(maria.caiu()).toBeVisible();
    await expect(maria.caiu()).toBeHidden({ timeout: 40_000 });
    await expect(maria.controles()).toBeVisible();
    await colega.esperarMosaicoDe2([VERMELHO, AMARELO]);
    await maria.esperarCores(MOSAICO_2, [VERMELHO, AMARELO]);

    // Ela voltou pelo canal novo, com a chave, e pediu a senha; nenhum pedido chegou à colega.
    // O aviso da câmera, que a página manda depois do voltou e a cada mudança dela, não é da volta, e sai da conta. O
    // resto é o voltar e a senha, sem um pedir novo.
    expect(
      maria
        .mensagensMandadas()
        .slice(mandadas)
        .map((m) => m.tipo)
        .filter((tipo) => tipo !== 'camera'),
    ).toEqual(['voltar', 'senha']);
    expect(pedidos(), 'os pedidos que chegaram à colega').toBe(antes);
    await expect.poll(() => ligacoesPrincipais(maria!.participante()), { timeout: 20_000 }).toBe(1);
    await maria.conferirOConsole();
  });
});
