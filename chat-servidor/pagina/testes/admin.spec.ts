// O estado dos ramais na página de administração, no Chromium, contra o chat de verdade no modo de teste (chat.ts):
// as duas páginas mostram o estado de cada ramal e se atualizam sozinhas a cada 30 s (o atualizar.js). Quem faz o
// papel do app é um computador de mentira (admin.ts), que fala a API do chat. Cada teste entra, cria a empresa dele e
// liga os computadores dele: os testes rodam ao mesmo tempo, no mesmo chat, e só conferem o que é da empresa deles.
// O relógio da página fica parado, e uma rodada da atualização é o relógio andar 30 s.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { Computador, criarEmpresa, entrar } from '../admin';

const RODADA_MS = 30_000;
const FRASE_DA_ATUALIZACAO = 'Esta página se atualiza sozinha a cada 30 segundos.';

/** Para o relógio da página (depois do page.clock.install e de a página abrir): daqui em diante, ele só anda pelas rodadas. */
async function pararORelogio(page: Page): Promise<void> {
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
}

/** Abre a página com o relógio parado. */
async function abrir(page: Page, caminho: string): Promise<void> {
  await page.goto(caminho);
  await pararORelogio(page);
}

/** Uma rodada da atualização: o relógio anda 30 s, e a busca que ela faz volta. Quem chama confere o que mudou na página. */
async function rodada(page: Page): Promise<void> {
  const endereco = page.url();
  const volta = page.waitForResponse((r) => r.url() === endereco && r.request().resourceType() === 'fetch');
  await page.clock.fastForward(RODADA_MS);
  await volta;
}

/** Uma rodada que não busca nada (o foco segura a troca), ou cuja busca não volta. */
async function rodadaSemVolta(page: Page): Promise<void> {
  await page.clock.fastForward(RODADA_MS);
}

/** A linha de uma pessoa na tabela das pessoas da página da empresa. */
function linha(page: Page, pessoa: string): Locator {
  return page.locator('[data-ao-vivo="pessoas"] tbody tr').filter({ has: page.locator('td.forte', { hasText: pessoa }) });
}

/** Confere o estado de uma pessoa: o nome do estado e a segunda linha. */
async function esperarEstado(page: Page, pessoa: string, estado: string, detalhe: string | RegExp): Promise<void> {
  await expect(linha(page, pessoa).locator('.estado-nome')).toHaveText(estado);
  await expect(linha(page, pessoa).locator('.estado-detalhe')).toHaveText(detalhe);
}

/** As contas de uma parte da página, na ordem: "1 online", "1 sem registro"… */
const contas = (onde: Locator) => onde.locator('.contagens .contagem');

const aviso = (page: Page) => page.locator('#sem-atualizar');

/** Leva o foco ao elemento pelo teclado (um Shift+Tab e um Tab), como quem anda pela página sem o mouse. */
async function focarPeloTeclado(page: Page, alvo: Locator): Promise<void> {
  await alvo.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(alvo).toBeFocused();
}

test.beforeEach(async ({ page, javaScriptEnabled }) => {
  // O relógio do Playwright entra na página por um script: sem o JavaScript, não há o que instalar.
  if (javaScriptEnabled !== false) await page.clock.install();
  await entrar(page);
});

// Um erro no console da página falha o teste: a regra de segurança das páginas (CSP) recusa em silêncio o que o script
// não pode fazer, e só o console conta. A busca cortada de propósito (o teste do aviso) é a exceção, dita por ele.
let errosDoConsole: string[];
let erroEsperado: RegExp | null;
test.beforeEach(({ page }) => {
  errosDoConsole = [];
  erroEsperado = null;
  page.on('console', (m) => {
    if (m.type() === 'error' && !(erroEsperado && erroEsperado.test(m.text()))) errosDoConsole.push(m.text());
  });
  page.on('pageerror', (e) => errosDoConsole.push(e.message));
});
test.afterEach(() => {
  expect(errosDoConsole, 'os erros do console da página').toEqual([]);
});

test('a página da empresa mostra o estado e se atualiza sozinha', async ({ page }) => {
  const empresa = await criarEmpresa(page, 'ACME Comércio');
  const pc = await Computador.ligar(empresa.codigo, 'NOTE-ANA', '2003', 'Ana Souza');
  await abrir(page, empresa.caminho);
  await page.evaluate(() => {
    (window as unknown as { __aMesmaPagina?: boolean }).__aMesmaPagina = true;
  });
  await esperarEstado(page, 'Ana Souza', 'Offline', /^última vez hoje, \d\d:\d\d$/);
  await expect(contas(page.locator('[data-ao-vivo="pessoas"]'))).toHaveText(['0 online', '1 offline']);
  // Com o script, a frase da atualização aparece.
  await expect(page.getByText(FRASE_DA_ATUALIZACAO)).toBeVisible();
  await expect(aviso(page)).toBeHidden();

  await pc.abrirCanal();
  await rodada(page);
  await esperarEstado(page, 'Ana Souza', 'No chat', 'o app é antigo e não diz o ramal');
  await expect(linha(page, 'Ana Souza').locator('.pc')).toHaveClass(/pc-no-chat/);

  expect(await pc.dizerRamal('conectado', 7200)).toBe(204);
  await rodada(page);
  await esperarEstado(page, 'Ana Souza', 'Online', 'há 2 h');
  await expect(contas(page.locator('[data-ao-vivo="pessoas"]'))).toHaveText(['1 online', '0 offline']);

  expect(await pc.dizerRamal('erro', 720)).toBe(204);
  await rodada(page);
  await esperarEstado(page, 'Ana Souza', 'Sem registro', 'há 12 min · o app diz “Erro no cadastro”');
  await expect(contas(page.locator('[data-ao-vivo="pessoas"]'))).toHaveText(['0 online', '1 sem registro', '0 offline']);
  await expect(linha(page, 'Ana Souza').locator('.pc')).toHaveClass(/pc-sem-registro/);

  await pc.fecharCanal();
  await rodada(page);
  await esperarEstado(page, 'Ana Souza', 'Offline', /^última vez hoje, \d\d:\d\d$/);

  // A página não recarregou em nenhum momento: só as partes dela foram trocadas.
  expect(await page.evaluate(() => (window as unknown as { __aMesmaPagina?: boolean }).__aMesmaPagina)).toBe(true);
  await expect(aviso(page)).toBeHidden();
});

test('a primeira página mostra a empresa e o ramal sem registro', async ({ page }) => {
  const empresa = await criarEmpresa(page, 'Clínica Vida');
  const pc = await Computador.ligar(empresa.codigo, 'CONSULTORIO-01', '1001', 'Recepção');
  await pc.abrirCanal();
  expect(await pc.dizerRamal('erro', 720)).toBe(204);
  await abrir(page, '/admin/');

  const daEmpresa = page.locator('[data-ao-vivo="empresas"] tbody tr').filter({ hasText: empresa.nome });
  const naLista = page.locator('[data-ao-vivo="sem-registro"] tbody tr').filter({ hasText: empresa.nome });
  await expect(contas(daEmpresa)).toHaveText(['0 online', '1 sem registro', '0 offline']);
  await expect(naLista.locator('td')).toHaveText([empresa.nome, 'Recepção', '1001', 'há 12 min', 'Erro no cadastro', 'Abrir']);
  await expect(naLista.getByRole('link', { name: `Abrir ${empresa.nome}` })).toHaveAttribute('href', empresa.caminho);
  // O cartão de número conta os ramais sem registro de todas as empresas (outros testes também põem os deles).
  await expect(page.locator('.numero-alerta .numero-legenda')).toHaveText(/^rama(l|is) sem registro agora$/);
  await expect(page.getByText(FRASE_DA_ATUALIZACAO)).toBeVisible();

  expect(await pc.dizerRamal('conectado', 5)).toBe(204);
  await rodada(page);
  await expect(contas(daEmpresa)).toHaveText(['1 online', '0 offline']);
  await expect(naLista).toHaveCount(0);
});

test('o foco num botão de formulário segura a troca', async ({ page }) => {
  const empresa = await criarEmpresa(page, 'ACME Comércio');
  const pc = await Computador.ligar(empresa.codigo, 'NOTE-ANA', '2003', 'Ana Souza');
  await pc.abrirCanal();
  expect(await pc.dizerRamal('conectado', 60)).toBe(204);
  await abrir(page, empresa.caminho);
  await esperarEstado(page, 'Ana Souza', 'Online', 'há 1 min');

  // O foco chega ao botão pelo teclado, sem apertar.
  const tirar = page.getByRole('button', { name: 'Tirar Ana Souza do chat' });
  await focarPeloTeclado(page, tirar);
  expect(await pc.dizerRamal('erro', 720)).toBe(204);

  // Na primeira rodada a página espera, sem dizer nada; da segunda em diante, ela avisa.
  await rodadaSemVolta(page);
  await esperarEstado(page, 'Ana Souza', 'Online', 'há 1 min');
  await expect(aviso(page)).toBeHidden();
  await rodadaSemVolta(page);
  await expect(aviso(page)).toHaveText(/^Sem atualizar desde as \d\d:\d\d: a página espera você sair do campo ou do botão em que está\.$/);
  await esperarEstado(page, 'Ana Souza', 'Online', 'há 1 min');
  await expect(tirar).toBeFocused();

  // O foco sai: a rodada seguinte troca, e o aviso some.
  await tirar.blur();
  await rodada(page);
  await esperarEstado(page, 'Ana Souza', 'Sem registro', 'há 12 min · o app diz “Erro no cadastro”');
  await expect(aviso(page)).toBeHidden();
});

test('o aviso quando a busca falha', async ({ page }) => {
  const empresa = await criarEmpresa(page, 'ACME Comércio');
  const pc = await Computador.ligar(empresa.codigo, 'NOTE-ANA', '2003', 'Ana Souza');
  await pc.abrirCanal();
  expect(await pc.dizerRamal('conectado', 60)).toBe(204);
  await abrir(page, empresa.caminho);
  await esperarEstado(page, 'Ana Souza', 'Online', 'há 1 min');

  // As buscas da página não chegam ao chat (o navegador escreve a falha no console: é a esperada).
  erroEsperado = /Failed to load resource|net::ERR_FAILED/;
  await page.route(`**${empresa.caminho}`, (rota) => rota.abort());
  expect(await pc.dizerRamal('erro', 720)).toBe(204);
  const tirar = page.getByRole('button', { name: 'Tirar Ana Souza do chat' });
  const antes = await tirar.boundingBox();
  await rodadaSemVolta(page);
  await expect(aviso(page)).toHaveText(/^Sem atualizar desde as \d\d:\d\d\. A página tenta de novo sozinha\.$/);
  await esperarEstado(page, 'Ana Souza', 'Online', 'há 1 min');
  // O aviso não empurra a página: o botão que estava debaixo do ponteiro continua no mesmo lugar.
  expect(await tirar.boundingBox()).toEqual(antes);

  // As buscas voltam: a rodada seguinte troca, e o aviso some.
  await page.unroute(`**${empresa.caminho}`);
  await rodada(page);
  await esperarEstado(page, 'Ana Souza', 'Sem registro', 'há 12 min · o app diz “Erro no cadastro”');
  await expect(aviso(page)).toBeHidden();
});

test('o aviso aparece com a página rolada até o fim', async ({ page }) => {
  const empresa = await criarEmpresa(page, 'ACME Comércio');
  for (let i = 1; i <= 25; i++) {
    await Computador.ligar(empresa.codigo, `PC-${i}`, String(2000 + i), `Pessoa ${String(i).padStart(2, '0')}`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await abrir(page, empresa.caminho);
  await expect(page.locator('[data-ao-vivo="pessoas"] tbody tr')).toHaveCount(25);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(400);

  erroEsperado = /Failed to load resource|net::ERR_FAILED/;
  await page.route(`**${empresa.caminho}`, (rota) => rota.abort());
  await rodadaSemVolta(page);
  // Quem olha o fim de uma tabela comprida vê o aviso: sem ele, o estado velho teria cara de novo.
  await expect(aviso(page)).toHaveText(/^Sem atualizar desde as \d\d:\d\d\. A página tenta de novo sozinha\.$/);
  await expect(aviso(page)).toBeInViewport({ ratio: 1 });
});

test('com o aviso na tela, o foco do teclado não fica atrás dele', async ({ page }) => {
  const empresa = await criarEmpresa(page, 'ACME Comércio');
  for (let i = 1; i <= 3; i++) {
    await Computador.ligar(empresa.codigo, `PC-${i}`, String(2000 + i), `Pessoa ${String(i).padStart(2, '0')}`);
  }
  // Numa janela estreita, o aviso ocupa a largura toda da janela.
  await page.setViewportSize({ width: 390, height: 800 });
  await abrir(page, empresa.caminho);
  erroEsperado = /Failed to load resource|net::ERR_FAILED/;
  await page.route(`**${empresa.caminho}`, (rota) => rota.abort());
  await rodadaSemVolta(page);
  await expect(aviso(page)).toHaveText(/A página tenta de novo sozinha\.$/);

  // O foco está no controle de antes, e o Apagar a empresa está dentro da janela, na altura do aviso.
  const apagar = page.getByRole('link', { name: 'Apagar a empresa' });
  const atrasDoAviso = () =>
    apagar.evaluate((e) => {
      const barra = document.getElementById('sem-atualizar')!.getBoundingClientRect();
      const alvo = e.getBoundingClientRect();
      return alvo.bottom > barra.top && alvo.top < barra.bottom && alvo.right > barra.left && alvo.left < barra.right;
    });
  await apagar.focus();
  await page.keyboard.press('Shift+Tab');
  await apagar.evaluate((e) => {
    const barra = document.getElementById('sem-atualizar')!.getBoundingClientRect();
    const alvo = e.getBoundingClientRect();
    window.scrollBy(0, alvo.top + alvo.height / 2 - (barra.top + barra.height / 2));
  });
  expect(await atrasDoAviso()).toBe(true);

  // O Tab leva o foco a ele, e a página rola o que falta para ele aparecer acima do aviso.
  await page.keyboard.press('Tab');
  await expect(apagar).toBeFocused();
  await expect.poll(atrasDoAviso).toBe(false);
  await expect(apagar).toBeInViewport({ ratio: 1 });
});

test('o foco do teclado num Abrir segura a troca, e o clique com o Ctrl não', async ({ page, context }) => {
  const empresa = await criarEmpresa(page, 'Clínica Vida');
  const pc = await Computador.ligar(empresa.codigo, 'CONSULTORIO-01', '1001', 'Recepção');
  await pc.abrirCanal();
  expect(await pc.dizerRamal('conectado', 60)).toBe(204);
  await abrir(page, '/admin/');
  const daEmpresa = page.locator('[data-ao-vivo="empresas"] tbody tr').filter({ hasText: empresa.nome });
  await expect(contas(daEmpresa)).toHaveText(['1 online', '0 offline']);

  // O clique com o Ctrl abre a empresa em outra aba, e o foco fica no link. A pessoa não está parada ali: a página
  // continua se atualizando, sem aviso.
  const [aba] = await Promise.all([
    context.waitForEvent('page'),
    daEmpresa.getByRole('link', { name: `Abrir ${empresa.nome}` }).click({ modifiers: ['ControlOrMeta'] }),
  ]);
  await aba.close();
  await expect(daEmpresa.getByRole('link', { name: `Abrir ${empresa.nome}` })).toBeFocused();
  expect(await pc.dizerRamal('erro', 720)).toBe(204);
  await rodadaSemVolta(page);
  await expect(contas(daEmpresa)).toHaveText(['0 online', '1 sem registro', '0 offline']);
  await expect(aviso(page)).toBeHidden();

  // Com o foco no mesmo link pelo teclado, a página espera: na segunda rodada, ela avisa.
  await focarPeloTeclado(page, daEmpresa.getByRole('link', { name: `Abrir ${empresa.nome}` }));
  expect(await pc.dizerRamal('conectado', 5)).toBe(204);
  await rodadaSemVolta(page);
  await rodadaSemVolta(page);
  await expect(aviso(page)).toHaveText(/a página espera você sair do campo ou do botão em que está\.$/);
  await expect(contas(daEmpresa)).toHaveText(['0 online', '1 sem registro', '0 offline']);
});

test('o ponteiro em cima de um botão de formulário segura a troca', async ({ page }) => {
  const empresa = await criarEmpresa(page, 'ACME Comércio');
  const pc = await Computador.ligar(empresa.codigo, 'NOTE-ANA', '2003', 'Ana Souza');
  await pc.abrirCanal();
  expect(await pc.dizerRamal('conectado', 60)).toBe(204);
  await abrir(page, empresa.caminho);
  await esperarEstado(page, 'Ana Souza', 'Online', 'há 1 min');

  // O Tirar do chat não tem volta: enquanto o ponteiro está em cima dele, as linhas não mudam de lugar.
  await page.getByRole('button', { name: 'Tirar Ana Souza do chat' }).hover();
  expect(await pc.dizerRamal('erro', 720)).toBe(204);
  await rodadaSemVolta(page);
  await esperarEstado(page, 'Ana Souza', 'Online', 'há 1 min');
  await expect(aviso(page)).toBeHidden();
  await rodadaSemVolta(page);
  await expect(aviso(page)).toHaveText(/a página espera você sair do campo ou do botão em que está\.$/);
  await esperarEstado(page, 'Ana Souza', 'Online', 'há 1 min');

  // O ponteiro sai: a rodada seguinte troca, e o aviso some.
  await page.mouse.move(0, 0);
  await rodada(page);
  await esperarEstado(page, 'Ana Souza', 'Sem registro', 'há 12 min · o app diz “Erro no cadastro”');
  await expect(aviso(page)).toBeHidden();
});

test('a rolagem para o lado fica onde estava', async ({ page }) => {
  const empresa = await criarEmpresa(page, 'ACME Comércio');
  const pc = await Computador.ligar(empresa.codigo, 'NOTE-ANA', '2003', 'Ana Souza');
  await pc.abrirCanal();
  expect(await pc.dizerRamal('conectado', 60)).toBe(204);
  await page.setViewportSize({ width: 390, height: 800 });
  await abrir(page, empresa.caminho);
  await esperarEstado(page, 'Ana Souza', 'Online', 'há 1 min');

  // Numa tela de celular, a tabela rola para o lado dentro do cartão dela.
  const cartao = page.locator('[data-ao-vivo="pessoas"]');
  await cartao.evaluate((e) => {
    e.scrollLeft = 300;
  });
  const rolado = await cartao.evaluate((e) => e.scrollLeft);
  expect(rolado).toBeGreaterThan(100);
  expect(await pc.dizerRamal('erro', 720)).toBe(204);
  await rodada(page);
  await esperarEstado(page, 'Ana Souza', 'Sem registro', 'há 12 min · o app diz “Erro no cadastro”');
  expect(await page.locator('[data-ao-vivo="pessoas"]').evaluate((e) => e.scrollLeft)).toBe(rolado);
});

test('duas abas quando a sessão vence', async ({ page, context }) => {
  const empresa = await criarEmpresa(page, 'ACME Comércio');
  await Computador.ligar(empresa.codigo, 'NOTE-ANA', '2003', 'Ana Souza');
  await abrir(page, '/admin/');
  const outra = await context.newPage();
  await outra.clock.install();
  await abrir(outra, empresa.caminho);

  const csrf = await page.locator('input[name="csrf"]').first().inputValue();
  expect((await page.request.post('/admin/sair', { form: { csrf }, maxRedirects: 0 })).status()).toBe(303);

  // As duas abas vão para a entrada, uma depois da outra.
  await rodadaSemVolta(page);
  await expect(page).toHaveURL(/\/admin\/entrar$/);
  await rodadaSemVolta(outra);
  await expect(outra).toHaveURL(/\/admin\/entrar$/);

  // A aba que chegou primeiro à entrada entra: ela não é recusada por causa da outra.
  await page.getByLabel('Usuário').fill('teste');
  await page.getByLabel('Senha').fill(process.env.CHAT_ADMIN_SENHA ?? '');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/admin\/$/);

  // A outra aba ficou na entrada. Quem preenche e manda essa entrada já está dentro: vai para a lista também.
  await outra.getByLabel('Usuário').fill('teste');
  await outra.getByLabel('Senha').fill(process.env.CHAT_ADMIN_SENHA ?? '');
  await outra.getByRole('button', { name: 'Entrar' }).click();
  await expect(outra).toHaveURL(/\/admin\/$/);
  await expect(outra.getByRole('heading', { level: 1 })).toHaveText('Empresas');
  await outra.close();
});

test('a página se recarrega quando o chat muda de versão', async ({ page }) => {
  const empresa = await criarEmpresa(page, 'ACME Comércio');
  const pc = await Computador.ligar(empresa.codigo, 'NOTE-ANA', '2003', 'Ana Souza');
  await pc.abrirCanal();
  expect(await pc.dizerRamal('conectado', 60)).toBe(204);
  await abrir(page, empresa.caminho);
  await esperarEstado(page, 'Ana Souza', 'Online', 'há 1 min');

  // O chat foi atualizado com a página aberta: a busca traz uma página que pede outro script, ou outro estilo (o
  // endereço de cada arquivo muda com o conteúdo dele). As partes novas não entram no meio do script e do estilo
  // velhos: a página se recarrega inteira.
  const mudancas: Array<[string, RegExp, string]> = [
    ['o script', /atualizar\.js\?v=[0-9a-f]{12}/, 'atualizar.js?v=000000000000'],
    ['o estilo', /estilo\.css\?v=[0-9a-f]{12}/, 'estilo.css?v=000000000000'],
  ];
  let estado = 'erro';
  for (const [qual, velho, novo] of mudancas) {
    await page.evaluate(() => {
      (window as unknown as { daCargaDeAntes?: boolean }).daCargaDeAntes = true;
    });
    const rota = `**${empresa.caminho}`;
    await page.route(rota, async (r) => {
      if (r.request().resourceType() !== 'fetch') return r.fallback();
      const resposta = await r.fetch();
      const html = await resposta.text();
      expect(html, qual).toMatch(velho);
      await r.fulfill({ response: resposta, body: html.replace(velho, novo) });
    });
    expect(await pc.dizerRamal(estado, 720)).toBe(204);
    await rodada(page);
    await esperarEstado(page, 'Ana Souza', estado === 'erro' ? 'Sem registro' : 'Online', /^há 12 min/);
    expect(
      await page.evaluate(() => (window as unknown as { daCargaDeAntes?: boolean }).daCargaDeAntes),
      `${qual} mudou de versão: a página é outra carga`,
    ).toBeUndefined();
    await page.unroute(rota);
    estado = 'conectado';
  }
  await expect(aviso(page)).toBeHidden();
});

test('a sessão que venceu leva à entrada', async ({ page }) => {
  const empresa = await criarEmpresa(page, 'ACME Comércio');
  await Computador.ligar(empresa.codigo, 'NOTE-ANA', '2003', 'Ana Souza');
  await abrir(page, empresa.caminho);
  await esperarEstado(page, 'Ana Souza', 'Offline', /^última vez hoje/);

  // A sessão acaba por fora da página (como quando ela vence, 12 horas depois da entrada).
  const csrf = await page.locator('input[name="csrf"]').first().inputValue();
  const saiu = await page.request.post('/admin/sair', { form: { csrf }, maxRedirects: 0 });
  expect(saiu.status()).toBe(303);

  // A página nunca desenha a entrada dentro dela: ela vai para a entrada.
  await rodadaSemVolta(page);
  await expect(page).toHaveURL(/\/admin\/entrar$/);
  await expect(page.getByLabel('Usuário')).toBeVisible();
  await expect(page.locator('[data-ao-vivo]')).toHaveCount(0);
});

test('a empresa apagada', async ({ page, context }) => {
  const empresa = await criarEmpresa(page, 'Transportadora Rota Sul');
  await Computador.ligar(empresa.codigo, 'EXPEDICAO-01', '4001', 'Expedição');
  await abrir(page, empresa.caminho);
  await esperarEstado(page, 'Expedição', 'Offline', /^última vez hoje/);

  // A empresa é apagada em outra aba do mesmo navegador.
  const outra = await context.newPage();
  await outra.goto(`${empresa.caminho}/apagar`);
  await outra.getByRole('textbox').fill(empresa.nome);
  await outra.getByRole('button', { name: 'Apagar a empresa' }).click();
  await expect(outra).toHaveURL(/\/admin\/$/);
  await outra.close();

  erroEsperado = /404/; // a busca da página que não existe mais
  await rodadaSemVolta(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Não encontrada' })).toBeVisible();
  await expect(page.locator('[data-ao-vivo]')).toHaveCount(0);
});

test('os botões continuam valendo depois de uma atualização', async ({ page }) => {
  const empresa = await criarEmpresa(page, 'ACME Comércio');
  const pc = await Computador.ligar(empresa.codigo, 'NOTE-ANA', '2003', 'Ana Souza');
  await Computador.ligar(empresa.codigo, 'FIN-01', '3004', 'Beatriz Ramos');
  await pc.abrirCanal();
  await abrir(page, empresa.caminho);
  await esperarEstado(page, 'Ana Souza', 'No chat', 'o app é antigo e não diz o ramal');

  expect(await pc.dizerRamal('conectado', 60)).toBe(204);
  await rodada(page);
  await esperarEstado(page, 'Ana Souza', 'Online', 'há 1 min');
  expect(await pc.dizerRamal('erro', 720)).toBe(204);
  await rodada(page);
  await esperarEstado(page, 'Ana Souza', 'Sem registro', 'há 12 min · o app diz “Erro no cadastro”');

  // O que fica fora das partes trocadas continua lá, e os formulários das partes trocadas funcionam.
  await expect(page.getByRole('button', { name: 'Copiar o código' })).toBeVisible();
  await expect(page.locator('#codigo')).toHaveText(empresa.codigo);
  await page.getByRole('button', { name: 'Tirar Beatriz Ramos do chat' }).click();
  await expect(page).toHaveURL(new RegExp(`${empresa.caminho}$`));
  await expect(linha(page, 'Beatriz Ramos')).toHaveCount(0);
  await expect(linha(page, 'Ana Souza')).toHaveCount(1);
});

test('nomes com sinais do HTML', async ({ page }) => {
  const NOME = '<b>&"Zé"';
  const empresa = await criarEmpresa(page, 'ACME Comércio');
  const pc = await Computador.ligar(empresa.codigo, '<i>PC</i>', '2003', NOME);
  await pc.abrirCanal();
  await abrir(page, empresa.caminho);
  expect(await pc.dizerRamal('erro', 720)).toBe(204);
  await rodada(page);
  await esperarEstado(page, NOME, 'Sem registro', 'há 12 min · o app diz “Erro no cadastro”');
  await expect(linha(page, NOME).locator('td.forte')).toHaveText(NOME);
  await expect(linha(page, NOME).locator('.chip')).toContainText('<i>PC</i>');
  // Depois da troca, os nomes continuam sendo texto: nenhum virou marcação.
  await expect(page.locator('[data-ao-vivo="pessoas"]').locator('b, i')).toHaveCount(0);
});

test('a barra do alto e a tela estreita', async ({ page }) => {
  const empresa = await criarEmpresa(page, 'ACME Comércio');
  await Computador.ligar(empresa.codigo, 'NOTE-ANA', '2003', 'Ana Souza');
  for (const caminho of [empresa.caminho, '/admin/']) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await abrir(page, caminho);
    // As contas não mexem em quem entrou, na barra do alto (as duas coisas já tiveram a mesma classe).
    const quem = page.locator('.topo .conta');
    await expect(quem).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(quem).toHaveCSS('border-top-width', '0px');
    await expect(quem.getByRole('button', { name: 'Sair' })).toBeVisible();
    // Numa tela de celular, a tabela rola dentro do cartão dela, e a página não rola para o lado.
    await page.setViewportSize({ width: 390, height: 800 });
    await expect(page.locator('[data-ao-vivo] table').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  }
});

test.describe('sem o JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('as duas páginas continuam certas, só não se atualizam sozinhas', async ({ page }) => {
    const empresa = await criarEmpresa(page, 'ACME Comércio');
    const pc = await Computador.ligar(empresa.codigo, 'NOTE-ANA', '2003', 'Ana Souza');
    await Computador.ligar(empresa.codigo, 'FIN-01', '3004', 'Beatriz Ramos');
    await pc.abrirCanal();
    expect(await pc.dizerRamal('erro', 720)).toBe(204);

    await page.goto(empresa.caminho);
    await esperarEstado(page, 'Ana Souza', 'Sem registro', 'há 12 min · o app diz “Erro no cadastro”');
    await esperarEstado(page, 'Beatriz Ramos', 'Offline', /^última vez hoje/);
    await expect(contas(page.locator('[data-ao-vivo="pessoas"]'))).toHaveText(['0 online', '1 sem registro', '1 offline']);
    await expect(page.getByText(FRASE_DA_ATUALIZACAO)).toBeHidden();
    await expect(page.getByText('Um PC que perde a rede pode levar até 2 minutos para aparecer offline.')).toBeVisible();
    await expect(aviso(page)).toBeHidden();

    await page.goto('/admin/');
    const daEmpresa = page.locator('[data-ao-vivo="empresas"] tbody tr').filter({ hasText: empresa.nome });
    await expect(contas(daEmpresa)).toHaveText(['0 online', '1 sem registro', '1 offline']);
    await expect(page.locator('[data-ao-vivo="sem-registro"] tbody tr').filter({ hasText: empresa.nome })).toHaveCount(1);
    await expect(page.getByText(FRASE_DA_ATUALIZACAO)).toBeHidden();
    await expect(page.getByText('Só aparecem os computadores com o app do Windows ligado ao chat')).toBeVisible();
    await expect(aviso(page)).toBeHidden();
  });
});
