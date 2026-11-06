// Os arquivos e as fotos na conversa (Task 7), contra o servidor do chat de teste: o clipe, arrastar e colar, os anexos
// com o "×" até o Enviar, o limite de 10 de uma vez e o de 25 MB, os arquivos na ordem e o texto por último, o progresso
// no balão (e os 15 s do "Não enviada", que só contam sem progresso), a miniatura de até 480 px e 204.800 bytes (lida
// do servidor), a miniatura que falha sem segurar a mensagem, a foto grande com o Baixar, o Fechar e o Esc, o clique no
// arquivo (o chatDownload), o nome, o tamanho e o tipo, o arquivo expirado, os nomes sem as marcas de direção (Review
// Focus 5), o nome de 120 caracteres sem rolar para o lado (Review Focus 4), o "Tentar de novo" (só o que faltou, com o
// mesmo idLocal e os 15 s), a miniatura que chega depois sem tirar o fim da vista nem mexer em quem lê mais acima, os
// blob: que saem com a tela deles e a acessibilidade nos dois temas. Cada teste cria a própria empresa.
import { expect, test, type Locator, type Page, type Request, type Route } from '@playwright/test';
import { capturar, comandos, esperarComando, mudarEstado, semViolacoesSerias } from '../helpers';
import { abrirAConversa, abrirNoChat, esperarOsEventos, pararORelogio } from './abrir';
import { arrastar, escolher, imagemDaPagina } from './anexar';
import { baseDoChat, empresaComPessoas, tirarPessoa, type ApiDeTeste } from './servidor';

// O CSP da página só deixa falar com o endereço do chat de verdade; o servidor de teste fica no 127.0.0.1:4180.
test.use({ bypassCSP: true });

const EMPRESA = 'ACME Comércio Ltda';
const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
const ANA = { ramal: '2003', nome: 'Ana Souza' };
const JOAO = { ramal: '2004', nome: 'João Pereira' };
/** A segunda conta do cenário chat-duas-contas. */
const CAIXA = { ramal: '2015', nome: 'Caixa 2' };
const ID_DA_CAIXA = '41aa07c3d2e95b18';
const PDF = 'application/pdf';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Um PNG de 1×1 (o servidor trata image/png como foto). */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** O POST dos arquivos (o PUT da miniatura e os GET têm o id no caminho: não casam com ele). */
const ARQUIVOS = `${baseDoChat()}/api/v1/arquivos`;
/** O endereço do POST das mensagens da conversa (o GET das páginas vem com a busca: não casa com ele). */
const envios = (conversa: number) => `${baseDoChat()}/api/v1/conversas/${conversa}/mensagens`;
const ehMiniatura = (url: URL) => /^\/api\/v1\/arquivos\/[0-9a-f]{32}\/miniatura$/.test(url.pathname);

const conversaCom = (page: Page, nome: string) => page.getByRole('log', { name: `Mensagens com ${nome}` });
const campoPara = (page: Page, nome: string) => page.getByRole('textbox', { name: `Mensagem para ${nome}` });
const botaoEnviar = (page: Page) => page.getByRole('button', { name: 'Enviar', exact: true });
const nomesDosAnexos = (page: Page) => page.locator('.anexo .anexo-nome');
const nomeDoTema = (tema: 'light' | 'dark') => (tema === 'light' ? 'claro' : 'escuro');
/** Um instante da página (um pedido que acabou de chegar já foi tratado). */
const umInstante = (page: Page) => page.evaluate(() => new Promise((r) => setTimeout(r, 200)));

/** Os blob: que a página criou e os que ela revogou (o espião vai antes de a página abrir). */
async function espiarOsBlobs(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __blobs: { criados: string[]; revogados: string[] } };
    w.__blobs = { criados: [], revogados: [] };
    const criar = URL.createObjectURL.bind(URL);
    const revogar = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (o: Blob | MediaSource) => {
      const url = criar(o);
      w.__blobs.criados.push(url);
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      w.__blobs.revogados.push(url);
      revogar(url);
    };
  });
}

const blobs = (page: Page) => page.evaluate(() => (window as unknown as { __blobs: { criados: string[]; revogados: string[] } }).__blobs);

/** A largura e a altura de um JPEG, lidas do SOF (o primeiro marcador de quadro: C0 a CF, menos o C4, o C8 e o CC). */
function medidasDoJpeg(jpeg: Buffer): { largura: number; altura: number } {
  expect(jpeg.subarray(0, 3).toString('hex')).toBe('ffd8ff');
  for (let i = 2; i + 9 <= jpeg.length; ) {
    if (jpeg[i] !== 0xff) throw new Error(`o JPEG não tem um marcador no byte ${i}`);
    const marcador = jpeg[i + 1];
    if (marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc) {
      return { altura: jpeg.readUInt16BE(i + 5), largura: jpeg.readUInt16BE(i + 7) };
    }
    i += 2 + jpeg.readUInt16BE(i + 2);
  }
  throw new Error('o JPEG não tem o SOF');
}

const jpegDaPagina = (page: Page, largura: number, altura: number) => imagemDaPagina(page, largura, altura);

/** A Recepção e a Ana, com a conversa a dois delas (a criada pela Ana). */
async function conversaComAna() {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  return { a, ana, dupla };
}

/** As medidas que mostram uma rolagem para o lado (como as do teste dos textos compridos da conversa). */
async function medirOsLados(page: Page) {
  return page.evaluate(() => {
    const log = document.querySelector('[role="log"]')!;
    const todos = [...document.querySelectorAll('.win *')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 || r.height > 0);
    return {
      janela: document.documentElement.scrollWidth,
      direita: Math.max(...todos.map((r) => r.right)),
      esquerda: Math.min(...todos.map((r) => r.left)),
      log: log.scrollWidth - log.clientWidth,
    };
  });
}

/**
 * A troca de conta pelo núcleo, com uma conversa aberta (a tela da conversa não tem o menu das contas): o estado chega
 * com a Caixa 2 em uso, como o C++ de mentira o manda depois de um selectAccount.
 */
async function trocarParaACaixaPeloNucleo(page: Page): Promise<void> {
  await mudarEstado(page, (s) => {
    const caixa = s.contas.find((c: { id: string }) => c.id === ID_DA_CAIXA);
    return {
      ...s,
      contas: s.contas.map((c: { id: string }) => ({ ...c, emUso: c.id === ID_DA_CAIXA })),
      conta: {
        id: caixa.id,
        nome: caixa.nome,
        ramal: caixa.ramal,
        servidor: caixa.servidor,
        protocolo: caixa.protocolo,
        status: 'conectado',
        texto: `Conectado · ${caixa.servidor}`,
        internet: true,
      },
      chat: { ...s.chat, contaConectada: true },
    };
  });
}

test('the clip picks files and photos, and they wait above the field with × until Enviar', async ({ page }) => {
  const { a, dupla } = await conversaComAna();
  const uploads: Request[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url() === ARQUIVOS) uploads.push(r);
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  // Um nome com acentos: ele vai no X-Arquivo-Nome, em percent-encoding do UTF-8.
  const foto = 'Promoção de verão.png';
  await escolher(page, [
    { name: 'Proposta ACME.pdf', mimeType: PDF, buffer: Buffer.from('a proposta da ACME') },
    { name: foto, mimeType: 'image/png', buffer: PNG },
  ]);
  await expect(nomesDosAnexos(page)).toHaveText(['Proposta ACME.pdf', foto]);
  // Em cima do campo, e nada sai antes do Enviar.
  const anexos = (await page.locator('.anexos').boundingBox())!;
  const campo = (await campoPara(page, 'Ana Souza').boundingBox())!;
  expect(anexos.y + anexos.height).toBeLessThanOrEqual(campo.y);
  await umInstante(page);
  expect(uploads).toHaveLength(0);

  await page.getByRole('button', { name: 'Tirar Proposta ACME.pdf' }).click();
  await expect(nomesDosAnexos(page)).toHaveText([foto]);
  await botaoEnviar(page).click();
  await expect(page.locator('.anexo')).toHaveCount(0);
  await expect.poll(async () => (await a.api.mensagens(dupla)).map((m) => m.arquivo?.nome)).toEqual([foto]);
  await expect(conversaCom(page, 'Ana Souza').getByRole('button', { name: `Abrir a foto ${foto}` })).toBeVisible();
  expect(uploads).toHaveLength(1);
  // O upload leva o Content-Length (o servidor reserva a cota da hora por ele), o tipo e o nome.
  const cabecalhos = await uploads[0].allHeaders();
  expect(cabecalhos['content-length']).toBe(String(PNG.length));
  expect(cabecalhos['content-type']).toBe('image/png');
  expect(cabecalhos['x-arquivo-nome']).toBe(encodeURIComponent(foto));
});

test('dragging into the conversation and Ctrl+V also attach', async ({ page }) => {
  const { a } = await conversaComAna();
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  const campo = campoPara(page, 'Ana Souza');

  // O arrastar: o dragover com arquivos aceita o drop, e o drop fica com a conversa (o WebView2 não abre o arquivo).
  const sobre = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['pedido'], 'Pedido 4471.xlsx'));
    return dt;
  });
  const aceita = await conversaCom(page, 'Ana Souza').evaluate(
    (log, dt) => !log.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })),
    sobre,
  );
  expect(aceita).toBe(true);
  expect(await arrastar(page, [{ nome: 'Pedido 4471.xlsx', tipo: XLSX, tamanho: 49_152 }])).toBe(true);
  await expect(nomesDosAnexos(page)).toHaveText(['Pedido 4471.xlsx']);

  // O Ctrl+V de um print: o paste com o arquivo no campo.
  const print = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(64)], 'image.png', { type: 'image/png' }));
    return dt;
  });
  const colou = await campo.evaluate(
    (el, dt) => !el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })),
    print,
  );
  expect(colou).toBe(true);
  await expect(nomesDosAnexos(page)).toHaveText(['Pedido 4471.xlsx', 'image.png']);

  // Um texto colado continua indo para o campo: o paste sem arquivo fica com o navegador.
  const texto = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'Segue o pedido.');
    return dt;
  });
  const tomou = await campo.evaluate(
    (el, dt) => !el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })),
    texto,
  );
  expect(tomou).toBe(false);
  await expect(nomesDosAnexos(page)).toHaveCount(2);
});

test('more than 10 files keeps 10 and says so', async ({ page }) => {
  const { a } = await conversaComAna();
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  const nomes = Array.from({ length: 12 }, (_, i) => `Pedido ${i + 1}.pdf`);
  await escolher(
    page,
    nomes.map((name) => ({ name, mimeType: PDF, buffer: Buffer.from(name) })),
  );
  await expect(nomesDosAnexos(page)).toHaveText(nomes.slice(0, 10));
  await expect(page.locator('.toast').getByText('Mande até 10 arquivos de uma vez.', { exact: true })).toBeVisible();

  // Com 10 em cima do campo, o próximo também fica de fora.
  await page.getByRole('button', { name: 'Tirar Pedido 3.pdf' }).click();
  expect(await arrastar(page, [{ nome: 'Pedido 13.pdf', tipo: PDF, tamanho: 10 }, { nome: 'Pedido 14.pdf', tipo: PDF, tamanho: 10 }])).toBe(true);
  await expect(nomesDosAnexos(page)).toHaveText([...nomes.slice(0, 10).filter((n) => n !== 'Pedido 3.pdf'), 'Pedido 13.pdf']);
});

test('a file over 25 MB stays out with Este arquivo passa de 25 MB.', async ({ page }) => {
  const { a } = await conversaComAna();
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  // 26.214.400 bytes (os 25 MB do servidor) ainda vai; um byte a mais, não.
  expect(
    await arrastar(page, [
      { nome: 'Backup.zip', tipo: 'application/zip', tamanho: 26_214_401 },
      { nome: 'Limite.zip', tipo: 'application/zip', tamanho: 26_214_400 },
    ]),
  ).toBe(true);
  await expect(nomesDosAnexos(page)).toHaveText(['Limite.zip']);
  await expect(page.locator('.toast').getByText('Este arquivo passa de 25 MB.', { exact: true })).toBeVisible();
});

test('files go first, in order, and the text last', async ({ page }) => {
  const { a, dupla } = await conversaComAna();
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  // O primeiro é o maior: mandados juntos, o segundo chegaria antes.
  await escolher(page, [
    { name: 'a.pdf', mimeType: PDF, buffer: Buffer.alloc(3 * 1024 * 1024, 1) },
    { name: 'b.xlsx', mimeType: XLSX, buffer: Buffer.from('b') },
  ]);
  const campo = campoPara(page, 'Ana Souza');
  await campo.fill('Seguem a proposta e a planilha.');
  await campo.press('Enter');
  await expect(campo).toHaveValue('');
  await expect(page.locator('.anexo')).toHaveCount(0);
  await expect
    .poll(async () => (await a.api.mensagens(dupla)).map((m) => m.arquivo?.nome ?? m.texto))
    .toEqual(['a.pdf', 'b.xlsx', 'Seguem a proposta e a planilha.']);
  const log = conversaCom(page, 'Ana Souza');
  await expect(log.locator('.balao-arquivo-nome')).toHaveText(['a.pdf', 'b.xlsx']);
  await expect(log.locator('.balao-texto')).toHaveText(['Seguem a proposta e a planilha.']);
  await expect(log.getByText('Enviando…', { exact: true })).toHaveCount(0);
});

test('the upload shows the progress in the bubble', async ({ page }) => {
  const { a } = await conversaComAna();
  await page.clock.install();
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  // O relógio parado: os 15 s só passam pelo runFor.
  await pararORelogio(page);
  await abrirAConversa(page, 'Ana Souza');
  await escolher(page, [{ name: 'Tabela de preços.pdf', mimeType: PDF, buffer: Buffer.alloc(2 * 1024 * 1024, 7) }]);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: 200 * 1024 });
  await botaoEnviar(page).click();

  const log = conversaCom(page, 'Ana Souza');
  const barra = log.getByRole('progressbar', { name: 'Tabela de preços.pdf' });
  const valor = async () => Number(await barra.getAttribute('aria-valuenow'));
  await expect.poll(async () => {
    const v = await valor();
    return v >= 1 && v <= 99;
  }).toBe(true);
  await expect(barra).toHaveAttribute('aria-valuemin', '0');
  await expect(barra).toHaveAttribute('aria-valuemax', '100');
  await expect(log.locator('.balao-hora')).toHaveText(['Enviando…']);

  // Os 15 s do "Não enviada" só contam sem progresso: cada pedaço que sai recomeça a conta.
  await page.clock.runFor(14_000);
  const antes = await valor();
  await expect.poll(valor).toBeGreaterThan(antes);
  await page.clock.runFor(14_000);
  await expect(log.getByText('Não enviada', { exact: true })).toHaveCount(0);
  await expect(barra).toBeVisible();
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
});

test('a photo goes with a thumbnail of at most 480 px and 204,800 bytes, and shows small', async ({ page }) => {
  await espiarOsBlobs(page);
  const { a, dupla } = await conversaComAna();
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  const log = conversaCom(page, 'Ana Souza');
  // Um PNG de 2000×1500, feito num canvas da página.
  const foto = await page.evaluateHandle(async () => {
    const c = document.createElement('canvas');
    c.width = 2000;
    c.height = 1500;
    const g = c.getContext('2d')!;
    const fundo = g.createLinearGradient(0, 0, 2000, 1500);
    fundo.addColorStop(0, '#0c2671');
    fundo.addColorStop(1, '#00c2cb');
    g.fillStyle = fundo;
    g.fillRect(0, 0, 2000, 1500);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `hsl(${i * 6}, 70%, 55%)`;
      g.beginPath();
      g.arc((i * 211) % 2000, (i * 137) % 1500, 40 + (i % 7) * 18, 0, Math.PI * 2);
      g.fill();
    }
    const png = await new Promise<Blob>((pronto) => c.toBlob((b) => pronto(b!), 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([png], 'Vitrine da loja.png', { type: 'image/png' }));
    return dt;
  });
  await log.evaluate((el, dt) => el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })), foto);
  await expect(nomesDosAnexos(page)).toHaveText(['Vitrine da loja.png']);
  await botaoEnviar(page).click();

  await expect.poll(async () => (await a.api.mensagens(dupla)).length).toBe(1);
  const [m] = await a.api.mensagens(dupla);
  expect(m.arquivo).toMatchObject({ nome: 'Vitrine da loja.png', tipo: 'image/png', foto: true, miniatura: true });
  const jpeg = await a.api.baixar(`/api/v1/arquivos/${m.arquivo.id}/miniatura`);
  expect(jpeg.length).toBeLessThanOrEqual(204_800);
  const { largura, altura } = medidasDoJpeg(jpeg);
  expect(Math.max(largura, altura)).toBeLessThanOrEqual(480);
  expect(Math.max(largura, altura)).toBeGreaterThanOrEqual(479);
  expect(largura / altura).toBeCloseTo(2000 / 1500, 1);

  // No balão, pequena, pela miniatura num blob: (a dela, com a proporção dela).
  const img = log.getByRole('button', { name: 'Abrir a foto Vitrine da loja.png' }).locator('img');
  await expect(img).toHaveAttribute('src', /^blob:/);
  const caixa = (await img.boundingBox())!;
  expect(caixa.width).toBeLessThanOrEqual(240);
  expect(caixa.width / caixa.height).toBeCloseTo(4 / 3, 1);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(largura);

  // O blob: da miniatura fica enquanto a conversa está aberta e sai quando ela fecha.
  const url = (await img.getAttribute('src'))!;
  expect((await blobs(page)).revogados).not.toContain(url);
  await page.getByRole('button', { name: 'Voltar para as conversas' }).click();
  await expect(page.getByRole('main', { name: 'Chat' })).toBeVisible();
  await expect.poll(async () => (await blobs(page)).revogados).toContain(url);
});

test('a thumbnail that fails does not hold the photo', async ({ page }) => {
  const { a, dupla } = await conversaComAna();
  await page.route(ehMiniatura, (rota) => (rota.request().method() === 'PUT' ? rota.abort() : rota.continue()));
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  await escolher(page, [{ name: 'nota-fiscal.png', mimeType: 'image/png', buffer: PNG }]);
  await botaoEnviar(page).click();
  await expect.poll(async () => (await a.api.mensagens(dupla)).map((m) => m.arquivo?.miniatura)).toEqual([false]);
  // Sem a miniatura, o quadro com o ícone e o nome.
  const foto = conversaCom(page, 'Ana Souza').getByRole('button', { name: 'Abrir a foto nota-fiscal.png' });
  await expect(foto.locator('.balao-foto-nome')).toHaveText('nota-fiscal.png');
  await expect(foto.locator('img')).toHaveCount(0);
  await expect(conversaCom(page, 'Ana Souza').getByText('Não enviada', { exact: true })).toHaveCount(0);
});

test('a click on the photo opens it big, Esc closes, and Baixar asks the core to download it', async ({ page }) => {
  await espiarOsBlobs(page);
  const { a, ana, dupla } = await conversaComAna();
  await ana.api.enviarArquivo(dupla, PNG, 'nota-fiscal.png', 'image/png');
  const [m] = await a.api.mensagens(dupla);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  const log = conversaCom(page, 'Ana Souza');

  await log.getByRole('button', { name: 'Abrir a foto nota-fiscal.png' }).click();
  const grande = page.getByRole('dialog', { name: 'nota-fiscal.png' });
  await expect(grande).toBeVisible();
  const img = grande.locator('img');
  await expect(img).toHaveAttribute('src', /^blob:/);
  const url = (await img.getAttribute('src'))!;
  // O blob: é do tipo da foto (o servidor manda o arquivo como application/octet-stream).
  expect(await page.evaluate(async (u) => (await (await fetch(u)).blob()).type, url)).toBe('image/png');
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);

  await grande.getByRole('button', { name: 'Baixar nota-fiscal.png' }).click();
  await esperarComando(page, { cmd: 'chatDownload', arquivo: m.arquivo.id, nome: 'nota-fiscal.png' });
  await expect(grande.getByRole('button', { name: 'Baixar nota-fiscal.png' })).toHaveText('Baixar');

  // O Esc fecha a foto (e não a conversa), o foco volta para o balão dela, e o blob: dela sai.
  await page.keyboard.press('Escape');
  await expect(grande).toHaveCount(0);
  await expect(log).toBeVisible();
  await expect(log.getByRole('button', { name: 'Abrir a foto nota-fiscal.png' })).toBeFocused();
  await expect.poll(async () => (await blobs(page)).revogados).toContain(url);

  // O Fechar também.
  await log.getByRole('button', { name: 'Abrir a foto nota-fiscal.png' }).click();
  await expect(img).toHaveAttribute('src', /^blob:/);
  const outra = (await img.getAttribute('src'))!;
  expect(outra).not.toBe(url);
  await grande.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(grande).toHaveCount(0);
  await expect.poll(async () => (await blobs(page)).revogados).toContain(outra);
});

test('a click on a file asks the core to download it', async ({ page }) => {
  const { a, ana, dupla } = await conversaComAna();
  await ana.api.enviarArquivo(dupla, Buffer.from('a proposta da ACME'), 'Proposta ACME.pdf', PDF);
  const [m] = await a.api.mensagens(dupla);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  await conversaCom(page, 'Ana Souza').getByRole('button', { name: 'Abrir Proposta ACME.pdf, 18 bytes' }).click();
  await esperarComando(page, { cmd: 'chatDownload', arquivo: m.arquivo.id, nome: 'Proposta ACME.pdf' });
  expect((await comandos(page)).filter((c) => c.cmd === 'chatDownload')).toHaveLength(1);
});

test('the file bubble shows the name, the size and the type', async ({ page }) => {
  const { a, ana, dupla } = await conversaComAna();
  await ana.api.enviarArquivo(dupla, Buffer.alloc(1_258_291, 1), 'Proposta ACME.pdf', PDF);
  await ana.api.enviarArquivo(dupla, Buffer.alloc(49_152, 1), 'Pedido 4471.xlsx', XLSX);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  const log = conversaCom(page, 'Ana Souza');
  await expect(log.locator('.balao-arquivo-nome')).toHaveText(['Proposta ACME.pdf', 'Pedido 4471.xlsx']);
  await expect(log.locator('.balao-arquivo-meta')).toHaveText(['1,2 MB · PDF', '48 KB · Planilha']);
  await expect(log.getByRole('button', { name: 'Abrir Proposta ACME.pdf, 1,2 MB' })).toBeVisible();
  await expect(log.getByRole('button', { name: 'Abrir Pedido 4471.xlsx, 48 KB' })).toBeVisible();
});

test('an expired file shows Arquivo expirado and does nothing on a click', async ({ page }) => {
  const { a, ana, dupla } = await conversaComAna();
  await ana.api.enviarArquivo(dupla, Buffer.from('a proposta da ACME'), 'Proposta ACME.pdf', PDF);
  await ana.api.enviarArquivo(dupla, PNG, 'nota-fiscal.png', 'image/png');
  // O GET das mensagens com os dois arquivos expirados (o servidor apaga o arquivo e a miniatura depois de 365 dias).
  await page.route(
    (url) => url.pathname === `/api/v1/conversas/${dupla}/mensagens`,
    async (rota) => {
      if (rota.request().method() !== 'GET') return rota.continue();
      const resposta = await rota.fetch();
      const json = await resposta.json();
      for (const m of json.mensagens) if (m.arquivo) Object.assign(m.arquivo, { expirado: true, miniatura: false });
      return rota.fulfill({ response: resposta, json });
    },
  );
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  const log = conversaCom(page, 'Ana Souza');
  const expirados = log.locator('.balao-expirado');
  await expect(expirados).toHaveCount(2);
  await expect(expirados.nth(0)).toContainText('Proposta ACME.pdf');
  await expect(expirados.nth(1)).toContainText('nota-fiscal.png');
  await expect(expirados.getByText('Arquivo expirado', { exact: true })).toHaveCount(2);
  await expect(log.getByRole('button', { name: /^Abrir/ })).toHaveCount(0);

  await expirados.nth(0).click();
  await expirados.nth(1).click();
  await umInstante(page);
  expect((await comandos(page)).filter((c) => c.cmd === 'chatDownload')).toHaveLength(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('names with direction marks show without them', async ({ page }) => {
  const { a, ana, dupla } = await conversaComAna();
  // Um ".exe" que aparece como ".pdf": o U+202E vira o fim do nome ao contrário. O U+061C (a marca de letra árabe)
  // também é um controle de direção (R35).
  const exe = 'Proposta\u202Efdp.exe';
  const foto = 'Vitrine\u061C\u202Egnp.html';
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await esperarOsEventos(page);
  await ana.api.enviarArquivo(dupla, PNG, foto, 'image/png');
  await ana.api.enviarArquivo(dupla, Buffer.from('nao abra'), exe, 'application/octet-stream');
  const mensagens = await a.api.mensagens(dupla);
  expect(mensagens.map((m) => m.arquivo.nome)).toEqual([foto, exe]);

  // O aviso do Windows e a prévia da lista.
  await esperarComando(page, { cmd: 'chatNotify', conversa: dupla, titulo: 'Ana Souza', texto: 'Arquivo: Propostafdp.exe' });
  await expect(page.locator('.chat-linha .chat-previa')).toHaveText(['Propostafdp.exe']);

  // O balão, os nomes de leitor de tela e o nome que vai para o núcleo baixar.
  await abrirAConversa(page, 'Ana Souza');
  const log = conversaCom(page, 'Ana Souza');
  await expect(log.locator('.balao-arquivo-nome')).toHaveText(['Propostafdp.exe']);
  expect(await log.locator('.balao-arquivo-nome').textContent()).toBe('Propostafdp.exe');
  await expect(log.locator('.balao-arquivo-meta')).toHaveText(['8 bytes · Arquivo']);
  await expect(log.locator('.balao-foto-nome')).toHaveText(['Vitrinegnp.html']);
  await log.getByRole('button', { name: 'Abrir Propostafdp.exe, 8 bytes', exact: true }).click();
  await esperarComando(page, { cmd: 'chatDownload', arquivo: mensagens[1].arquivo.id, nome: 'Propostafdp.exe' });
  await log.getByRole('button', { name: 'Abrir a foto Vitrinegnp.html', exact: true }).click();
  const grande = page.getByRole('dialog', { name: 'Vitrinegnp.html' });
  await grande.getByRole('button', { name: 'Baixar Vitrinegnp.html', exact: true }).click();
  await esperarComando(page, { cmd: 'chatDownload', arquivo: mensagens[0].arquivo.id, nome: 'Vitrinegnp.html' });
  await page.keyboard.press('Escape');
  await expect(grande).toHaveCount(0);

  // Um anexo com as marcas, em cima do campo.
  expect(await arrastar(page, [{ nome: 'Pedido\u202Excod\u061C.exe', tipo: '', tamanho: 10 }])).toBe(true);
  await expect(nomesDosAnexos(page)).toHaveText(['Pedidoxcod.exe']);
  await expect(page.getByRole('button', { name: 'Tirar Pedidoxcod.exe', exact: true })).toBeVisible();
  const textos = await page.locator('.win').evaluate((el) => el.textContent ?? '');
  expect(textos).not.toMatch(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/);
});

test('a 120-character file name never scrolls the window sideways', async ({ page }) => {
  const { a, ana, dupla } = await conversaComAna();
  const pdf = `${'PropostaDaACME'.repeat(8)}Ltda.pdf`;
  const foto = `${'VitrineDaLojaACME'.repeat(6)}MatrizMatrizSP.png`;
  const anexo = `${'PedidoDeCompraACME'.repeat(6)}LoteNum.xlsx`;
  for (const nome of [pdf, foto, anexo]) expect([...nome]).toHaveLength(120);
  await ana.api.enviarArquivo(dupla, Buffer.from('a proposta da ACME'), pdf, PDF);
  await ana.api.enviarArquivo(dupla, PNG, foto, 'image/png');
  // O meu envio fica parado no upload: o balão do Pendente, com o progresso.
  await page.route(ARQUIVOS, (rota) => (rota.request().method() === 'POST' ? undefined : rota.continue()));

  for (const largura of [400, 300]) {
    await page.setViewportSize({ width: largura, height: 720 });
    await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
    await abrirAConversa(page, 'Ana Souza');
    const log = conversaCom(page, 'Ana Souza');
    await expect(log.locator('.balao-arquivo-nome')).toHaveText([pdf]);
    expect(await arrastar(page, [{ nome: pdf, tipo: PDF, tamanho: 2048 }])).toBe(true);
    await botaoEnviar(page).click();
    await expect(log.getByRole('progressbar', { name: pdf })).toBeVisible();
    expect(await arrastar(page, [{ nome: anexo, tipo: XLSX, tamanho: 2048 }])).toBe(true);
    await expect(nomesDosAnexos(page)).toHaveText([anexo]);

    const medidas = await medirOsLados(page);
    expect(medidas.janela, `${largura} px`).toBeLessThanOrEqual(largura);
    expect(medidas.direita, `${largura} px`).toBeLessThanOrEqual(largura + 0.5);
    expect(medidas.esquerda, `${largura} px`).toBeGreaterThanOrEqual(-0.5);
    expect(medidas.log, `${largura} px`).toBeLessThanOrEqual(0);
    await capturar(page, `chat-arquivos-nome-comprido-${largura}`, 'claro');

    // A foto grande, com o nome inteiro.
    await log.getByRole('button', { name: `Abrir a foto ${foto}` }).click();
    await expect(page.getByRole('dialog', { name: foto })).toBeVisible();
    const naFoto = await medirOsLados(page);
    expect(naFoto.janela, `${largura} px, a foto grande`).toBeLessThanOrEqual(largura);
    expect(naFoto.direita, `${largura} px, a foto grande`).toBeLessThanOrEqual(largura + 0.5);
    expect(naFoto.esquerda, `${largura} px, a foto grande`).toBeGreaterThanOrEqual(-0.5);
    await page.keyboard.press('Escape');
  }
});

test('Tentar de novo sends a file that failed again', async ({ page }) => {
  const { a, dupla } = await conversaComAna();
  // O primeiro upload cai; os outros passam.
  let uploads = 0;
  await page.route(ARQUIVOS, (rota) => {
    if (rota.request().method() !== 'POST') return rota.continue();
    uploads += 1;
    return uploads === 1 ? rota.abort() : rota.continue();
  });
  const corpos: Array<{ idLocal: string; arquivo: string }> = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url() === envios(dupla)) corpos.push(r.postDataJSON());
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  await escolher(page, [{ name: 'Proposta ACME.pdf', mimeType: PDF, buffer: Buffer.from('a proposta da ACME') }]);
  await botaoEnviar(page).click();
  const log = conversaCom(page, 'Ana Souza');
  const minha = log.locator('.balao-meu');
  await expect(minha.getByText('Não enviada', { exact: true })).toBeVisible();
  // O upload não foi: nenhuma mensagem saiu.
  expect(corpos).toHaveLength(0);

  await minha.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect.poll(async () => (await a.api.mensagens(dupla)).length).toBe(1);
  const [m] = await a.api.mensagens(dupla);
  expect(m.arquivo.nome).toBe('Proposta ACME.pdf');
  expect(uploads).toBe(2);
  expect(corpos).toEqual([{ idLocal: m.idLocal, arquivo: m.arquivo.id }]);
  await expect(minha.getByRole('button', { name: 'Abrir Proposta ACME.pdf, 18 bytes' })).toBeVisible();
  await expect(minha.getByText('Não enviada', { exact: true })).toHaveCount(0);
  await expect(log.locator('.balao')).toHaveCount(1);
});

test('Tentar de novo after the message failed sends only the message, with the same idLocal', async ({ page }) => {
  const { a, dupla } = await conversaComAna();
  let uploads = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url() === ARQUIVOS) uploads += 1;
  });
  // O upload passa; o primeiro POST da mensagem cai.
  const corpos: Array<{ idLocal: string; arquivo: string }> = [];
  await page.route(envios(dupla), (rota) => {
    if (rota.request().method() !== 'POST') return rota.continue();
    corpos.push(rota.request().postDataJSON());
    return corpos.length === 1 ? rota.abort() : rota.continue();
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  await escolher(page, [{ name: 'Proposta ACME.pdf', mimeType: PDF, buffer: Buffer.from('a proposta da ACME') }]);
  await botaoEnviar(page).click();
  const minha = conversaCom(page, 'Ana Souza').locator('.balao-meu');
  await expect(minha.getByText('Não enviada', { exact: true })).toBeVisible();
  expect(uploads).toBe(1);

  await minha.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect.poll(async () => (await a.api.mensagens(dupla)).length).toBe(1);
  const [m] = await a.api.mensagens(dupla);
  expect(corpos).toEqual([
    { idLocal: m.idLocal, arquivo: m.arquivo.id },
    { idLocal: m.idLocal, arquivo: m.arquivo.id },
  ]);
  expect(uploads).toBe(1);
  await expect(minha.getByText('Não enviada', { exact: true })).toHaveCount(0);
});

test('Tentar de novo after the thumbnail and the message failed sends the two again, and not the upload', async ({ page }) => {
  const { a, dupla } = await conversaComAna();
  let uploads = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url() === ARQUIVOS) uploads += 1;
  });
  // O primeiro PUT da miniatura e o primeiro POST da mensagem caem; os outros passam.
  let miniaturas = 0;
  await page.route(ehMiniatura, (rota) => {
    if (rota.request().method() !== 'PUT') return rota.continue();
    miniaturas += 1;
    return miniaturas === 1 ? rota.abort() : rota.continue();
  });
  let mensagens = 0;
  await page.route(envios(dupla), (rota) => {
    if (rota.request().method() !== 'POST') return rota.continue();
    mensagens += 1;
    return mensagens === 1 ? rota.abort() : rota.continue();
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  await escolher(page, [{ name: 'nota-fiscal.png', mimeType: 'image/png', buffer: PNG }]);
  await botaoEnviar(page).click();
  const minha = conversaCom(page, 'Ana Souza').locator('.balao-meu');
  // A miniatura que falhou não segurou a mensagem: ela saiu, e caiu.
  await expect(minha.getByText('Não enviada', { exact: true })).toBeVisible();
  expect([uploads, miniaturas, mensagens]).toEqual([1, 1, 1]);

  await minha.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect.poll(async () => (await a.api.mensagens(dupla)).map((m) => m.arquivo?.miniatura)).toEqual([true]);
  expect([uploads, miniaturas, mensagens]).toEqual([1, 2, 2]);
  await expect(minha.getByRole('button', { name: 'Abrir a foto nota-fiscal.png' }).locator('img')).toHaveAttribute('src', /^blob:/);
});

test('a file with no answer in 15 seconds is Não enviada, also after Tentar de novo', async ({ page }) => {
  const { a, dupla } = await conversaComAna();
  await page.clock.install();
  // Os dois primeiros uploads ficam sem resposta; o terceiro passa.
  const presos: Route[] = [];
  await page.route(ARQUIVOS, (rota) => {
    if (rota.request().method() !== 'POST') return rota.continue();
    presos.push(rota);
    if (presos.length === 3) return rota.continue();
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  // O relógio parado: nenhum prazo passa sozinho, numa máquina lenta.
  await pararORelogio(page);
  await abrirAConversa(page, 'Ana Souza');
  await escolher(page, [{ name: 'Proposta ACME.pdf', mimeType: PDF, buffer: Buffer.from('a proposta da ACME') }]);
  await botaoEnviar(page).click();
  const minha = conversaCom(page, 'Ana Souza').locator('.balao-meu');
  await expect(minha.locator('.balao-hora')).toHaveText(['Enviando…']);
  await expect.poll(() => presos.length).toBe(1);
  await page.waitForTimeout(200);
  await page.clock.runFor(15_000);
  await expect(minha.getByText('Não enviada', { exact: true })).toBeVisible();

  // O "Tentar de novo" volta ao "Enviando…" e tem os mesmos 15 s.
  await minha.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(minha.locator('.balao-hora')).toHaveText(['Enviando…']);
  await expect.poll(() => presos.length).toBe(2);
  await page.waitForTimeout(200);
  await page.clock.runFor(14_000);
  await expect(minha.locator('.balao-hora')).toHaveText(['Enviando…']);
  await page.clock.runFor(1_000);
  await expect(minha.getByText('Não enviada', { exact: true })).toBeVisible();

  await minha.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect.poll(async () => (await a.api.mensagens(dupla)).length).toBe(1);
  await expect(minha.getByText('Não enviada', { exact: true })).toHaveCount(0);
  await expect(minha.getByRole('button', { name: 'Abrir Proposta ACME.pdf, 18 bytes' })).toBeVisible();
});

// --- (Fix round 1) A ordem de um Enviar também depois de uma falha (R38) ------------------------------------------

/** O texto do Enviar dos testes da ordem: vai depois do a.pdf e do b.xlsx. */
const TEXTO_DO_LOTE = 'Seguem a proposta e a planilha.';

/** Um Enviar com dois arquivos (o a.pdf e o b.xlsx) e o texto. */
async function mandarOLote(page: Page): Promise<void> {
  await escolher(page, [
    { name: 'a.pdf', mimeType: PDF, buffer: Buffer.from('a proposta') },
    { name: 'b.xlsx', mimeType: XLSX, buffer: Buffer.from('a planilha') },
  ]);
  const campo = campoPara(page, 'Ana Souza');
  await campo.fill(TEXTO_DO_LOTE);
  await campo.press('Enter');
}

/** O meu balão com este arquivo (ou este texto). */
const balaoMeu = (page: Page, conteudo: string) => conversaCom(page, 'Ana Souza').locator('.balao-meu').filter({ hasText: conteudo });
/** As mensagens da conversa no servidor, na ordem dos ids: o nome do arquivo, ou o texto. */
const noServidor = async (api: ApiDeTeste, conversa: number) => (await api.mensagens(conversa)).map((m) => m.arquivo?.nome ?? m.texto);
/** O nome do arquivo de um upload (o X-Arquivo-Nome dele). */
const nomeDoUpload = (r: Request) => decodeURIComponent(r.headers()['x-arquivo-nome']);

test('a file that fails stops the rest of its Enviar, and Tentar de novo on it sends them all in order', async ({ page }) => {
  const { a, dupla } = await conversaComAna();
  // O primeiro upload (o do a.pdf) cai; os outros passam.
  const uploads: string[] = [];
  await page.route(ARQUIVOS, (rota) => {
    if (rota.request().method() !== 'POST') return rota.continue();
    uploads.push(nomeDoUpload(rota.request()));
    return uploads.length === 1 ? rota.abort() : rota.continue();
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  await mandarOLote(page);
  // O b.xlsx e o texto não saem depois da falha: os três ficam "Não enviada".
  for (const item of ['a.pdf', 'b.xlsx', TEXTO_DO_LOTE]) {
    await expect(balaoMeu(page, item).getByText('Não enviada', { exact: true })).toBeVisible();
  }
  await umInstante(page);
  expect(uploads).toEqual(['a.pdf']);
  expect(await noServidor(a.api, dupla)).toEqual([]);

  await balaoMeu(page, 'a.pdf').getByRole('button', { name: 'Tentar de novo' }).click();
  await expect.poll(() => noServidor(a.api, dupla)).toEqual(['a.pdf', 'b.xlsx', TEXTO_DO_LOTE]);
  expect(uploads).toEqual(['a.pdf', 'a.pdf', 'b.xlsx']);
  await expect(conversaCom(page, 'Ana Souza').getByText('Não enviada', { exact: true })).toHaveCount(0);
});

test('a file with no progress for 15 seconds is the only one Não enviada, and Tentar de novo starts over with it', async ({ page }) => {
  const { a, dupla } = await conversaComAna();
  await page.clock.install();
  // O primeiro upload fica sem resposta, o segundo espera o teste, e os outros passam.
  const uploads: Route[] = [];
  await page.route(ARQUIVOS, (rota) => {
    if (rota.request().method() !== 'POST') return rota.continue();
    uploads.push(rota);
    if (uploads.length > 2) return rota.continue();
  });
  const cancelados: string[] = [];
  page.on('requestfailed', (r) => {
    if (r.url() === ARQUIVOS) cancelados.push(nomeDoUpload(r));
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  // O relógio parado: os 15 s só passam pelo runFor.
  await pararORelogio(page);
  await abrirAConversa(page, 'Ana Souza');
  await mandarOLote(page);
  await expect.poll(() => uploads.length).toBe(1);
  await page.waitForTimeout(200);
  await page.clock.runFor(15_000);
  // Só o da vez fica "Não enviada"; os de trás continuam esperando a vez deles.
  await expect(balaoMeu(page, 'a.pdf').getByText('Não enviada', { exact: true })).toBeVisible();
  await expect(balaoMeu(page, 'b.xlsx').locator('.balao-hora')).toHaveText('Enviando…');
  await expect(balaoMeu(page, TEXTO_DO_LOTE).locator('.balao-hora')).toHaveText('Enviando…');
  expect(uploads).toHaveLength(1);
  expect(await noServidor(a.api, dupla)).toEqual([]);

  // O Tentar de novo cancela o upload que ainda está vivo e recomeça por ele, sem passar ao b.xlsx.
  await balaoMeu(page, 'a.pdf').getByRole('button', { name: 'Tentar de novo' }).click();
  await expect.poll(() => uploads.length).toBe(2);
  await expect.poll(() => cancelados).toEqual(['a.pdf']);
  await page.waitForTimeout(300);
  expect(uploads.map((r) => nomeDoUpload(r.request()))).toEqual(['a.pdf', 'a.pdf']);
  await uploads[1].continue();
  await expect.poll(() => noServidor(a.api, dupla)).toEqual(['a.pdf', 'b.xlsx', TEXTO_DO_LOTE]);
  expect(uploads.map((r) => nomeDoUpload(r.request()))).toEqual(['a.pdf', 'a.pdf', 'b.xlsx']);
});

test('a progress after the 15 seconds brings the file back to Enviando…, with the bar, and the rest keep waiting', async ({ page }) => {
  const { a, dupla } = await conversaComAna();
  await page.clock.install();
  // O upload do a.pdf fica parado (nenhum pedaço sai) até o teste soltar; o POST da mensagem dele também.
  let upload: Route | null = null;
  await page.route(ARQUIVOS, (rota) => {
    if (rota.request().method() !== 'POST' || upload !== null) return rota.continue();
    upload = rota;
  });
  let mensagem: Route | null = null;
  await page.route(envios(dupla), (rota) => {
    if (rota.request().method() !== 'POST' || mensagem !== null) return rota.continue();
    mensagem = rota;
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await pararORelogio(page);
  await abrirAConversa(page, 'Ana Souza');
  await mandarOLote(page);
  await expect.poll(() => upload !== null).toBe(true);
  await page.waitForTimeout(200);
  await page.clock.runFor(15_000);
  const aPdf = balaoMeu(page, 'a.pdf');
  await expect(aPdf.getByText('Não enviada', { exact: true })).toBeVisible();
  await expect(aPdf.getByRole('progressbar')).toHaveCount(0);
  await expect(balaoMeu(page, 'b.xlsx').locator('.balao-hora')).toHaveText('Enviando…');

  // O upload anda: o a.pdf volta para "Enviando…", com a barra, e os de trás continuam esperando.
  await upload!.continue();
  await expect(aPdf.locator('.balao-hora')).toHaveText('Enviando…');
  await expect(aPdf.getByRole('progressbar', { name: 'a.pdf' })).toBeVisible();
  await expect(aPdf.getByText('Não enviada', { exact: true })).toHaveCount(0);
  await expect.poll(() => mensagem !== null).toBe(true);
  await expect(balaoMeu(page, 'b.xlsx').locator('.balao-hora')).toHaveText('Enviando…');
  expect(await noServidor(a.api, dupla)).toEqual([]);
  await mensagem!.continue();
  await expect.poll(() => noServidor(a.api, dupla)).toEqual(['a.pdf', 'b.xlsx', TEXTO_DO_LOTE]);
});

test('Tentar de novo on a stopped file sends it and the ones after it, and the failed one before stays Não enviada', async ({ page }) => {
  const { a, dupla } = await conversaComAna();
  const uploads: string[] = [];
  await page.route(ARQUIVOS, (rota) => {
    if (rota.request().method() !== 'POST') return rota.continue();
    uploads.push(nomeDoUpload(rota.request()));
    return uploads.length === 1 ? rota.abort() : rota.continue();
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  await mandarOLote(page);
  for (const item of ['a.pdf', 'b.xlsx', TEXTO_DO_LOTE]) {
    await expect(balaoMeu(page, item).getByText('Não enviada', { exact: true })).toBeVisible();
  }

  await balaoMeu(page, 'b.xlsx').getByRole('button', { name: 'Tentar de novo' }).click();
  await expect.poll(() => noServidor(a.api, dupla)).toEqual(['b.xlsx', TEXTO_DO_LOTE]);
  await umInstante(page);
  await expect(balaoMeu(page, 'a.pdf').getByText('Não enviada', { exact: true })).toBeVisible();
  expect(uploads).toEqual(['a.pdf', 'b.xlsx']);
});

test('a separate Enviar of a text during a long upload goes right away', async ({ page }) => {
  const { a, dupla } = await conversaComAna();
  // O upload fica sem resposta (um arquivo grande numa rede lenta).
  let uploads = 0;
  await page.route(ARQUIVOS, (rota) => {
    if (rota.request().method() !== 'POST') return rota.continue();
    uploads += 1;
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  await escolher(page, [{ name: 'Tabela de preços.pdf', mimeType: PDF, buffer: Buffer.from('a tabela') }]);
  await botaoEnviar(page).click();
  await expect.poll(() => uploads).toBe(1);
  const campo = campoPara(page, 'Ana Souza');
  await campo.fill('Já te mando a tabela.');
  await campo.press('Enter');
  await expect.poll(() => noServidor(a.api, dupla)).toEqual(['Já te mando a tabela.']);
  await expect(balaoMeu(page, 'Tabela de preços.pdf').locator('.balao-hora')).toHaveText('Enviando…');
});

// --- (Fix round 1) O colar do Excel e o arrastar fora da conversa (R39) -------------------------------------------

/** Põe na área de transferência de verdade o texto e (com a `imagem`) uma imagem PNG ao lado dele. */
async function copiar(page: Page, o: { texto?: string; imagem?: boolean }): Promise<void> {
  await page.evaluate(async ({ texto, imagem }) => {
    const itens: Record<string, Blob> = {};
    if (texto !== undefined) itens['text/plain'] = new Blob([texto], { type: 'text/plain' });
    if (imagem) {
      const c = document.createElement('canvas');
      c.width = 8;
      c.height = 8;
      itens['image/png'] = await new Promise<Blob>((pronto) => c.toBlob((b) => pronto(b!), 'image/png'));
    }
    await navigator.clipboard.write([new ClipboardItem(itens)]);
  }, o);
}

test('Ctrl+V of cells from Excel (the text with an image beside it) pastes the text and attaches nothing', async ({ page, context }) => {
  const { a } = await conversaComAna();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  const campo = campoPara(page, 'Ana Souza');
  // Duas células do Excel: o texto, com um tab entre elas, e a imagem delas ao lado (no Windows, o CF_DIB chega como
  // um arquivo image/png).
  const celulas = ['Pedido 4471', '12'].join(String.fromCharCode(9));
  await copiar(page, { texto: celulas, imagem: true });
  await campo.focus();
  await page.keyboard.press('Control+V');
  await expect(campo).toHaveValue(celulas);
  await umInstante(page);
  await expect(page.locator('.anexo')).toHaveCount(0);

  // O mesmo paste num DataTransfer montado na página: ele fica com o navegador.
  const ambos = await page.evaluateHandle((texto) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', texto);
    dt.items.add(new File([new Uint8Array(64)], 'image.png', { type: 'image/png' }));
    return dt;
  }, celulas);
  const tomou = await campo.evaluate(
    (el, dt) => !el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })),
    ambos,
  );
  expect(tomou).toBe(false);
  await umInstante(page);
  await expect(page.locator('.anexo')).toHaveCount(0);

  // Só a imagem (um print), pelo Ctrl+V de verdade: ela vira um anexo, e o campo fica como estava.
  await copiar(page, { imagem: true });
  await campo.focus();
  await page.keyboard.press('Control+V');
  await expect(nomesDosAnexos(page)).toHaveText(['image.png']);
  await expect(campo).toHaveValue(celulas);

  // Um texto só de espaços não é um texto: a imagem ao lado dele vira um anexo.
  const espacos = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '   ');
    dt.items.add(new File([new Uint8Array(64)], 'print.png', { type: 'image/png' }));
    return dt;
  });
  const anexou = await campo.evaluate(
    (el, dt) => !el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })),
    espacos,
  );
  expect(anexou).toBe(true);
  await expect(nomesDosAnexos(page)).toHaveText(['image.png', 'print.png']);
});

/** Um evento de arrastar (o `dragover` ou o `drop`) com um arquivo, no elemento. true: alguém o impediu (o preventDefault). */
async function arrastarSobre(alvo: Locator, tipo: 'dragover' | 'drop', comArquivo = true): Promise<boolean> {
  return alvo.evaluate(
    (el, { tipo, comArquivo }) => {
      const dt = new DataTransfer();
      if (comArquivo) dt.items.add(new File(['pedido'], 'Pedido 4471.xlsx'));
      else dt.setData('text/plain', 'Pedido 4471');
      return !el.dispatchEvent(new DragEvent(tipo, { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    { tipo, comArquivo },
  );
}

test('a file dropped outside the conversation, or in one with someone who left, attaches nothing and never navigates', async ({ page }) => {
  const { empresaId, pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await ana.api.enviarTexto(dupla, 'Hoje é o meu último dia. Obrigada por tudo!');
  await tirarPessoa(empresaId, ana.pessoa.id);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });

  // Fora da conversa (a lista, o cabeçalho, as abas, a barra de título): o arquivo nunca vira a página.
  const lista = page.getByRole('main', { name: 'Chat' });
  await expect(lista.locator('.chat-linha')).toHaveCount(1);
  for (const alvo of [lista, page.locator('header.brand'), page.getByRole('navigation', { name: 'Seções' }), page.locator('.titlebar')]) {
    expect(await arrastarSobre(alvo, 'dragover')).toBe(true);
    expect(await arrastarSobre(alvo, 'drop')).toBe(true);
  }
  // Um texto arrastado (sem arquivo) continua com o navegador.
  expect(await arrastarSobre(lista, 'dragover', false)).toBe(false);
  await expect(page.getByRole('main', { name: 'Chat' })).toBeVisible();

  // Na conversa com quem saiu do chat: nada entra (nem há onde escrever), e nada navega.
  await abrirAConversa(page, 'Ana Souza (saiu)');
  const log = conversaCom(page, 'Ana Souza (saiu)');
  await expect(log).toBeVisible();
  expect(await arrastarSobre(log, 'dragover')).toBe(true);
  expect(await arrastarSobre(log, 'drop')).toBe(true);
  await umInstante(page);
  await expect(page.locator('.anexo')).toHaveCount(0);
  await expect(page.getByText('Ana Souza saiu do chat.', { exact: true })).toBeVisible();
});

test('a thumbnail that arrives late keeps the end in view, and moves nothing for who reads above', async ({ page }) => {
  const { a, ana, dupla } = await conversaComAna();
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  // Uma miniatura em pé: a foto cresce bem mais que 80 px quando ela chega (o quadro tem 140).
  const retrato = await jpegDaPagina(page, 360, 480);
  const primeira = await ana.api.enviarFoto(dupla, PNG, 'Vitrine 1.png', retrato);
  for (let i = 1; i <= 30; i++) await ana.api.enviarTexto(dupla, `Mensagem ${i}`);
  const segunda = await ana.api.enviarFoto(dupla, PNG, 'Vitrine 2.png', retrato);
  // As miniaturas ficam presas até o teste soltar cada uma.
  const presas = new Map<string, Route>();
  await page.route(ehMiniatura, (rota) => {
    if (rota.request().method() !== 'GET') return rota.continue();
    presas.set(new URL(rota.request().url()).pathname.split('/')[4], rota);
  });
  await abrirAConversa(page, 'Ana Souza');
  const log = conversaCom(page, 'Ana Souza');
  await expect(log.locator('.balao-texto')).toHaveCount(30);
  await esperarOsEventos(page);
  await expect.poll(() => presas.size).toBe(2);
  const doFim = () => log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  await expect.poll(doFim).toBeLessThan(2);

  // Embaixo: a última foto cresce com a miniatura, e o fim continua à vista.
  const foto2 = log.getByRole('button', { name: 'Abrir a foto Vitrine 2.png' });
  const altura2 = (await foto2.boundingBox())!.height;
  await presas.get(segunda.arquivo)!.continue();
  await expect(foto2.locator('img')).toHaveAttribute('src', /^blob:/);
  expect((await foto2.boundingBox())!.height).toBeGreaterThan(altura2 + 80);
  await expect.poll(doFim).toBeLessThan(2);

  // Lendo mais acima, com a primeira foto logo acima da vista: ela cresce, e o que está na tela fica no lugar.
  const lida = log.getByText('Mensagem 1', { exact: true });
  await lida.evaluate((el) => {
    const balao = el.closest<HTMLElement>('.balao')!;
    balao.parentElement!.scrollTop = balao.offsetTop - 4;
  });
  await umInstante(page);
  const foto1 = log.getByRole('button', { name: 'Abrir a foto Vitrine 1.png' });
  await expect(foto1).not.toBeInViewport();
  const topo = (await lida.boundingBox())!.y;
  await presas.get(primeira.arquivo)!.continue();
  await expect(foto1.locator('img')).toHaveAttribute('src', /^blob:/);
  await umInstante(page);
  expect(Math.abs((await lida.boundingBox())!.y - topo)).toBeLessThan(1);

  // Uma foto nova chega embaixo, longe da vista: nem ela nem a miniatura dela mexem na tela.
  const terceira = await ana.api.enviarFoto(dupla, PNG, 'Vitrine 3.png', retrato);
  await expect.poll(() => presas.has(terceira.arquivo)).toBe(true);
  await presas.get(terceira.arquivo)!.continue();
  await expect(log.getByRole('button', { name: 'Abrir a foto Vitrine 3.png' }).locator('img')).toHaveAttribute('src', /^blob:/);
  await umInstante(page);
  expect(Math.abs((await lida.boundingBox())!.y - topo)).toBeLessThan(1);
  expect(await doFim()).toBeGreaterThan(80);
});

test('the blob: of the thumbnails go when the conversation closes and when the group leaves the list', async ({ page }) => {
  await espiarOsBlobs(page);
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, JOAO]);
  const [a, joao] = pessoas;
  const grupo = await joao.api.criarGrupo('Comercial', [a.pessoa.id]);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await joao.api.enviarFoto(grupo, PNG, 'Vitrine da loja.png', await jpegDaPagina(page, 480, 360));
  await abrirAConversa(page, 'Comercial');
  const img = page.getByRole('button', { name: 'Abrir a foto Vitrine da loja.png' }).locator('img');
  await expect(img).toHaveAttribute('src', /^blob:/);
  const primeira = (await img.getAttribute('src'))!;
  await page.getByRole('button', { name: 'Voltar para as conversas' }).click();
  await expect.poll(async () => (await blobs(page)).revogados).toContain(primeira);

  // O grupo sai da lista com a conversa aberta (João tira a Recepção): a conversa fecha, e o blob: dela sai.
  await abrirAConversa(page, 'Comercial');
  await expect(img).toHaveAttribute('src', /^blob:/);
  const segunda = (await img.getAttribute('src'))!;
  expect(segunda).not.toBe(primeira);
  await esperarOsEventos(page);
  await joao.api.tirarDoGrupo(grupo, a.pessoa.id);
  await expect(page.getByRole('main', { name: 'Chat' })).toBeVisible();
  await expect.poll(async () => (await blobs(page)).revogados).toContain(segunda);
  const { criados, revogados } = await blobs(page);
  expect(criados.filter((u) => !revogados.includes(u))).toEqual([]);
});

test('the blob: of the thumbnails go when the account switches with the conversation open', async ({ page }) => {
  await espiarOsBlobs(page);
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO, cenario: 'chat-duas-contas' });
  await ana.api.enviarFoto(dupla, PNG, 'Vitrine da loja.png', await jpegDaPagina(page, 480, 360));
  await abrirAConversa(page, 'Ana Souza');
  const img = conversaCom(page, 'Ana Souza').getByRole('button', { name: 'Abrir a foto Vitrine da loja.png' }).locator('img');
  await expect(img).toHaveAttribute('src', /^blob:/);
  const url = (await img.getAttribute('src'))!;

  await trocarParaACaixaPeloNucleo(page);
  await expect(page.locator('.account-name')).toHaveText(`${CAIXA.nome} · ${CAIXA.ramal}`);
  await expect(conversaCom(page, 'Ana Souza')).toHaveCount(0);
  await expect.poll(async () => (await blobs(page)).revogados).toContain(url);
});

for (const tema of ['light', 'dark'] as const) {
  test.describe(`os arquivos (${tema})`, () => {
    test.use({ colorScheme: tema });

    test('the files, the photos and the attachments have no serious accessibility violations', async ({ page }) => {
      const { a, ana, dupla } = await conversaComAna();
      await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
      const vitrine = await imagemDaPagina(page, 1200, 900, 'image/png');
      await ana.api.enviarFoto(dupla, vitrine, 'Vitrine da loja.png', await jpegDaPagina(page, 480, 360));
      await ana.api.enviarArquivo(dupla, Buffer.alloc(49_152, 1), 'Pedido 4471.xlsx', XLSX);
      await a.api.enviarArquivo(dupla, Buffer.alloc(1_258_291, 1), 'Proposta ACME.pdf', PDF);
      await ana.api.enviarArquivo(dupla, PNG, 'nota-fiscal.png', 'image/png');
      // Um envio que fica no upload (o progresso) e outro que não sai (o "Não enviada" com o "Tentar de novo").
      let uploads = 0;
      await page.route(ARQUIVOS, (rota) => {
        if (rota.request().method() !== 'POST') return rota.continue();
        uploads += 1;
        if (uploads === 2) return rota.abort();
      });

      await abrirAConversa(page, 'Ana Souza');
      const log = conversaCom(page, 'Ana Souza');
      await expect(log.getByRole('button', { name: 'Abrir a foto Vitrine da loja.png' }).locator('img')).toHaveAttribute('src', /^blob:/);
      expect(await arrastar(page, [{ nome: 'Contrato ACME.pdf', tipo: PDF, tamanho: 4096 }])).toBe(true);
      await botaoEnviar(page).click();
      await expect(log.getByRole('progressbar', { name: 'Contrato ACME.pdf' })).toBeVisible();
      expect(await arrastar(page, [{ nome: 'Planilha de custos.xlsx', tipo: XLSX, tamanho: 4096 }])).toBe(true);
      await botaoEnviar(page).click();
      await expect(log.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
      expect(await arrastar(page, [{ nome: 'Pedido 4472.xlsx', tipo: XLSX, tamanho: 8192 }, { nome: 'Fachada.png', tipo: 'image/png', tamanho: 64 }])).toBe(true);
      await expect(nomesDosAnexos(page)).toHaveText(['Pedido 4472.xlsx', 'Fachada.png']);
      // O meu arquivo em blue no claro e em cyan no escuro, com o texto on-cyan.
      const meu = log.getByRole('button', { name: 'Abrir Proposta ACME.pdf, 1,2 MB' });
      await expect(meu).toHaveCSS('background-color', tema === 'light' ? 'rgb(12, 38, 113)' : 'rgb(0, 194, 203)');
      await expect(meu).toHaveCSS('color', tema === 'light' ? 'rgb(255, 255, 255)' : 'rgb(3, 34, 42)');
      await semViolacoesSerias(page);
      await capturar(page, 'chat-arquivos', nomeDoTema(tema));

      // A foto grande, com uma foto de 1200×900 (e o quadro sem miniatura, a nota-fiscal.png, também abre).
      await log.getByRole('button', { name: 'Abrir a foto Vitrine da loja.png' }).click();
      const grande = page.getByRole('dialog', { name: 'Vitrine da loja.png' });
      await expect.poll(() => grande.locator('img').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1200);
      await semViolacoesSerias(page);
      await capturar(page, 'chat-foto-grande', nomeDoTema(tema));
      await page.keyboard.press('Escape');
      await log.getByRole('button', { name: 'Abrir a foto nota-fiscal.png' }).click();
      await expect(page.getByRole('dialog', { name: 'nota-fiscal.png' }).locator('img')).toHaveAttribute('src', /^blob:/);
    });
  });
}
