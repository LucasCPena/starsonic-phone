// A área do administrador (rc.3, spec 6): o Ctrl + P abre o diálogo "Área do administrador" (só na janela principal,
// um por vez, nunca no aviso do canto nem por cima da ligação); a senha é conferida no C++ (a ponte falsa aceita só a
// senha de teste); o erro e a espera depois de 5 erradas seguem o `entrarAdmin` (a `vez` diz que a tentativa foi
// respondida); a tela tem os botões da tela principal, os atalhos, os servidores e o canal.
import { expect, test, type Page } from '@playwright/test';
import {
  abrir,
  capturar,
  comandos,
  entrarNaAdmin,
  esperarComando,
  mudarEstado,
  segurarCpp,
  SENHA_ADMIN_TESTE,
  semViolacoesSerias,
  soltarCpp,
  verTextos,
  vezes,
} from './helpers';

const dialogo = (page: Page) => page.getByRole('dialog', { name: 'Área do administrador' });
const telaAdmin = (page: Page) => page.getByRole('heading', { name: 'Área do administrador', level: 1 });
const nomeDoTema = (tema: 'light' | 'dark') => (tema === 'light' ? 'claro' : 'escuro');

/** Um Ctrl + P (o keydown que a página recebe): diz se ele foi impedido (o imprimir do navegador não abre). */
async function ctrlPImpedido(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const e = new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', ctrlKey: true, bubbles: true, cancelable: true });
    (document.activeElement ?? document.body).dispatchEvent(e);
    return e.defaultPrevented;
  });
}

const SERVIDORES = [
  { endereco: 'starcloud-starsonic.com.br', porta: 5060 },
  { endereco: 'starcloud1-starsonic.com.br', porta: 35060 },
];

for (const tema of ['light', 'dark'] as const) {
  test.describe(`o diálogo do administrador (${tema})`, () => {
    test.use({ colorScheme: tema });

    test('ctrl p opens one admin dialog and only in the main window', async ({ page }) => {
      await abrir(page, 'principal');
      await page.keyboard.press('Control+KeyP');
      await expect(dialogo(page)).toBeVisible();
      await verTextos(page, ['Área do administrador', 'Configurações da Starsonic para este computador.', 'Senha', 'Cancelar', 'Entrar']);
      const senha = dialogo(page).getByLabel('Senha', { exact: true });
      await expect(senha).toBeFocused();
      await expect(senha).toHaveAttribute('type', 'password');
      await semViolacoesSerias(page);
      await capturar(page, 'admin-senha', nomeDoTema(tema));

      // De novo com o diálogo aberto: nada abre outra vez, e o Ctrl + P continua impedido.
      await page.keyboard.press('Control+KeyP');
      expect(await ctrlPImpedido(page)).toBe(true);
      await page.waitForTimeout(200);
      await expect(page.locator('dialog[open]')).toHaveCount(1);
      // Esc e Cancelar fecham sem mandar nada.
      await page.keyboard.press('Escape');
      await expect(dialogo(page)).toHaveCount(0);
      await page.keyboard.press('Control+KeyP');
      await expect(dialogo(page)).toBeVisible();
      await dialogo(page).getByRole('button', { name: 'Cancelar' }).click();
      await expect(dialogo(page)).toHaveCount(0);
      expect((await comandos(page)).filter((c) => String(c.cmd).startsWith('admin'))).toEqual([]);
    });
  });
}

test.describe('o Ctrl + P', () => {
  test('never opens the dialog in the notice window, over a call or over another dialog', async ({ page }) => {
    // O aviso do canto: nenhum diálogo, e o Ctrl + P nem é tratado lá.
    await page.setViewportSize({ width: 380, height: 168 });
    await abrir(page, 'aviso', 'aviso.html');
    await page.keyboard.press('Control+KeyP');
    expect(await ctrlPImpedido(page)).toBe(false);
    await page.waitForTimeout(200);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Área do administrador')).toHaveCount(0);

    // Na ligação: impedido (o app não imprime), mas nada por cima da tela da ligação.
    await page.setViewportSize({ width: 400, height: 720 });
    await abrir(page, 'ligacao');
    expect(await ctrlPImpedido(page)).toBe(true);
    await page.keyboard.press('Control+KeyP');
    await page.waitForTimeout(200);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Desligar', exact: true })).toBeVisible();

    // Com outro diálogo aberto (a confirmação de remover um atalho): só ele.
    await abrir(page, 'atalhos');
    await page.getByRole('button', { name: 'Mais opções para Comercial' }).click();
    await page.getByRole('menuitem', { name: 'Remover' }).click();
    await expect(page.getByRole('dialog', { name: 'Remover atalho' })).toBeVisible();
    await page.keyboard.press('Control+KeyP');
    expect(await ctrlPImpedido(page)).toBe(true);
    await page.waitForTimeout(200);
    await expect(page.locator('dialog[open]')).toHaveCount(1);
    await expect(dialogo(page)).toHaveCount(0);
    expect((await comandos(page)).filter((c) => String(c.cmd).startsWith('admin'))).toEqual([]);
  });

  test('does nothing over an open menu (the header Menu, the account list and a card menu)', async ({ page }) => {
    await abrir(page, 'atalhos');
    const menus: Array<[string, () => Promise<void>]> = [
      ['Menu', () => page.getByRole('button', { name: 'Menu' }).click()],
      ['Contas', () => page.getByRole('button', { name: /Trocar de conta/ }).click()],
      ['Opções de Suporte', () => page.getByRole('button', { name: 'Mais opções para Suporte' }).click()],
    ];
    for (const [nome, abrirMenu] of menus) {
      await abrirMenu();
      await expect(page.getByRole('menu', { name: nome })).toBeVisible();
      await page.keyboard.press('Control+KeyP');
      expect(await ctrlPImpedido(page), nome).toBe(true);
      await page.waitForTimeout(200);
      await expect(dialogo(page), nome).toHaveCount(0);
      await expect(page.getByRole('menu', { name: nome })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
    }
    // Sem menu aberto, o Ctrl + P abre o diálogo.
    await page.keyboard.press('Control+KeyP');
    await expect(dialogo(page)).toBeVisible();
    expect((await comandos(page)).filter((c) => String(c.cmd).startsWith('admin'))).toEqual([]);
  });

  test('an incoming call closes the dialog, and it does not come back after the call', async ({ page }) => {
    await abrir(page, 'principal');
    await page.keyboard.press('Control+KeyP');
    await dialogo(page).getByLabel('Senha', { exact: true }).fill('meio-digitada');
    await mudarEstado(page, (s) => ({
      ...s,
      ligacao: {
        top: { id: 31, number: '2003', name: 'Ana Souza', incoming: true, phase: 'ringing', activeSinceMs: 0, held: false },
        second: null,
        secondKind: 'none',
        muted: false,
        conference: false,
        conferenceSinceMs: 0,
        consulting: false,
        colleagueActive: false,
      },
    }));
    await expect(page.getByRole('button', { name: 'Atender', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await mudarEstado(page, (s) => ({ ...s, ligacao: null }));
    await expect(page.getByRole('textbox', { name: 'Número' })).toBeVisible();
    await page.waitForTimeout(200);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('#adm-senha')).toHaveCount(0);
    expect((await comandos(page)).some((c) => c.cmd === 'adminLogin')).toBe(false);
  });

  test('opens the admin screen directly while the area is open, also from the Entrar screen', async ({ page }) => {
    await abrir(page, 'entrar');
    await page.keyboard.press('Control+KeyP');
    await dialogo(page).getByLabel('Senha', { exact: true }).fill(SENHA_ADMIN_TESTE);
    await dialogo(page).getByRole('button', { name: 'Entrar' }).click();
    await esperarComando(page, { cmd: 'adminLogin', senha: SENHA_ADMIN_TESTE });
    await expect(dialogo(page)).toHaveCount(0);
    await expect(telaAdmin(page)).toBeVisible();
    await expect(page.locator('.titlebar-text')).toHaveText('Starsonic Phone · Administrador');
    await page.getByRole('button', { name: 'Voltar' }).click();
    await expect(page.getByRole('heading', { name: 'Entre com o seu ramal' })).toBeVisible();
    // Aberta: o Ctrl + P vai direto para a área, sem pedir a senha de novo.
    await page.keyboard.press('Control+KeyP');
    await expect(telaAdmin(page)).toBeVisible();
    await expect(dialogo(page)).toHaveCount(0);
    expect(await vezes(page, { cmd: 'adminLogin', senha: SENHA_ADMIN_TESTE })).toBe(1);
  });
});

test('wrong admin password shows Senha incorreta and the wait', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-22T10:00:00-03:00') });
  await abrir(page, 'principal');
  await page.keyboard.press('Control+KeyP');
  const senha = dialogo(page).getByLabel('Senha', { exact: true });
  const entrar = dialogo(page).getByRole('button', { name: 'Entrar' });
  const erro = dialogo(page).getByRole('alert');
  // Sem nada digitado, nada a mandar (e o Entrar parece travado).
  await expect(entrar).toBeDisabled();
  const opacidade = () => entrar.evaluate((e) => parseFloat(getComputedStyle(e).opacity));
  expect(await opacidade()).toBeLessThan(0.6);

  await senha.fill('errada-1');
  await expect.poll(opacidade).toBe(1);
  await entrar.click();
  await esperarComando(page, { cmd: 'adminLogin', senha: 'errada-1' });
  await expect(erro).toHaveText('Senha incorreta.');
  await expect(senha).toHaveValue('');
  await expect(senha).toHaveAttribute('aria-invalid', 'true');
  await expect(senha).toHaveAccessibleDescription(/Senha incorreta\./);
  await semViolacoesSerias(page);
  // A segunda errada: o mesmo erro (só a vez muda) e o campo limpo de novo; o Enter também entra.
  await senha.fill('errada-2');
  await senha.press('Enter');
  await esperarComando(page, { cmd: 'adminLogin', senha: 'errada-2' });
  await expect(senha).toHaveValue('');
  await expect(erro).toHaveText('Senha incorreta.');
  // Fechar e abrir de novo: o erro de antes não aparece.
  await page.keyboard.press('Escape');
  await expect(dialogo(page)).toHaveCount(0);
  await page.keyboard.press('Control+KeyP');
  await expect(dialogo(page)).toBeVisible();
  await expect(erro).toHaveCount(0);

  await senha.fill('errada-3');
  await senha.press('Enter');
  await esperarComando(page, { cmd: 'adminLogin', senha: 'errada-3' });
  // A resposta chegou (o campo limpo): até ela, o Entrar fica travado e o Enter não manda outra tentativa.
  await expect(senha).toHaveValue('');
  await senha.fill('errada-4');
  await senha.press('Enter');
  await esperarComando(page, { cmd: 'adminLogin', senha: 'errada-4' });
  await expect(senha).toHaveValue('');
  // A 5ª errada, às 10:05: daqui em diante o relógio parado, e a contagem só anda com o runFor.
  await page.clock.pauseAt(new Date('2026-10-22T10:05:00-03:00'));
  await senha.fill('errada-5');
  await senha.press('Enter');
  await page.clock.runFor(100);
  await esperarComando(page, { cmd: 'adminLogin', senha: 'errada-5' });
  // A contagem que a pessoa vê (a região viva da espera, escondida, tem o mesmo texto: o teste de baixo a confere).
  const espera = dialogo(page).locator('#adm-espera');
  await expect(espera).toHaveText('Muitas tentativas. Tente de novo em 30 s.');
  await expect(erro).toHaveText('Senha incorreta.');
  await expect(senha).toHaveValue('');
  await senha.fill(SENHA_ADMIN_TESTE);
  await expect(entrar).toBeDisabled();
  expect(await opacidade()).toBeLessThan(0.6);
  await page.clock.runFor(10_000);
  await expect(espera).toHaveText('Muitas tentativas. Tente de novo em 20 s.');

  // 25 s depois da 5ª errada (às 10:05:25), faltam 5 s: fechar e abrir de novo não tira a espera (o erro de antes,
  // sim). O relógio segue parado até lá (o runFor): um resume seguido de pauseAt às vezes volta a hora para trás no
  // relógio falso do Playwright (um tique de tempo real no meio termina depois do pauseAt). O axe da espera fica no
  // teste de baixo.
  await page.clock.runFor(14_900);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+KeyP');
  await page.clock.runFor(100);
  await expect(dialogo(page)).toBeVisible();
  await expect(espera).toHaveText('Muitas tentativas. Tente de novo em 5 s.');
  await expect(erro).toHaveCount(0);
  await senha.fill(SENHA_ADMIN_TESTE);
  await expect(entrar).toBeDisabled();
  await page.clock.runFor(5_000);
  await expect(espera).toHaveCount(0);
  await expect(entrar).toBeEnabled();

  // A senha certa abre a área.
  await page.clock.resume();
  await entrar.click();
  await expect(dialogo(page)).toHaveCount(0);
  await expect(telaAdmin(page)).toBeVisible();
  // Nenhum adminLogin saiu durante a espera.
  expect((await comandos(page)).filter((c) => c.cmd === 'adminLogin').map((c) => c.senha)).toEqual([
    'errada-1',
    'errada-2',
    'errada-3',
    'errada-4',
    'errada-5',
    SENHA_ADMIN_TESTE,
  ]);
});

// A espera passa no axe, com o relógio de verdade (o axe usa os relógios da página; a espera dura 30 s).
test('the wait after five wrong passwords passes axe', async ({ page }) => {
  await abrir(page, 'principal');
  await page.keyboard.press('Control+KeyP');
  const senha = dialogo(page).getByLabel('Senha', { exact: true });
  for (let vez = 1; vez <= 5; vez++) {
    await senha.fill(`errada-${vez}`);
    await senha.press('Enter');
    await esperarComando(page, { cmd: 'adminLogin', senha: `errada-${vez}` });
    await expect(senha).toHaveValue('');
  }
  await expect(dialogo(page).locator('#adm-espera')).toHaveText(/^Muitas tentativas\. Tente de novo em \d+ s\.$/);
  // Com a senha certa digitada, o Entrar continua travado pela espera.
  await senha.fill(SENHA_ADMIN_TESTE);
  await expect(dialogo(page).getByRole('button', { name: 'Entrar' })).toBeDisabled();
  await semViolacoesSerias(page);
  await capturar(page, 'admin-espera', 'claro');
});

// A espera depois de 5 erradas é dita uma vez (C-M3): quem usa leitor de tela digita a senha certa, aperta Enter e, sem
// isto, não ouve por que nada acontece (só o "Senha incorreta." do alerta, como nas quatro tentativas de antes). O texto
// da espera vai, com o primeiro valor, para uma região viva; a contagem que anda fica fora de qualquer uma.
test('the 30 s wait is announced once in a live region, and the countdown that ticks is outside any', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-22T10:00:00-03:00') });
  await abrir(page, 'principal');
  await page.keyboard.press('Control+KeyP');
  const senha = dialogo(page).getByLabel('Senha', { exact: true });
  for (let vez = 1; vez <= 4; vez++) {
    await senha.fill(`errada-${vez}`);
    await senha.press('Enter');
    await esperarComando(page, { cmd: 'adminLogin', senha: `errada-${vez}` });
    await expect(senha).toHaveValue('');
  }
  // Dali em diante, cada vez que o texto de uma região viva do diálogo ganha "Muitas tentativas" (inserido ou trocado).
  await page.evaluate(() => {
    const w = window as unknown as { __anuncios: string[] };
    w.__anuncios = [];
    new MutationObserver((registros) => {
      for (const r of registros) {
        const no = r.type === 'characterData' ? r.target.parentElement : (r.target as Element);
        const viva = no?.closest('[role="status"], [role="alert"], [role="log"], [aria-live]:not([aria-live="off"])');
        if (viva?.textContent?.includes('Muitas tentativas')) w.__anuncios.push(viva.textContent);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.clock.pauseAt(new Date('2026-10-22T10:05:00-03:00'));
  await senha.fill('errada-5');
  await senha.press('Enter');
  await page.clock.runFor(100);
  await esperarComando(page, { cmd: 'adminLogin', senha: 'errada-5' });
  const espera = dialogo(page).locator('#adm-espera');
  await expect(espera).toHaveText('Muitas tentativas. Tente de novo em 30 s.');
  // A região viva tem o texto da espera, com o primeiro valor.
  const vivas = dialogo(page).locator('[role="status"], [role="alert"], [aria-live]').filter({ hasText: 'Muitas tentativas' });
  await expect(vivas).toHaveCount(1);
  await expect(vivas).toHaveText('Muitas tentativas. Tente de novo em 30 s.');
  // A contagem anda (20 s) e a região viva não muda: o leitor de tela não repete a cada segundo.
  await page.clock.runFor(10_000);
  await expect(espera).toHaveText('Muitas tentativas. Tente de novo em 20 s.');
  await expect(vivas).toHaveText('Muitas tentativas. Tente de novo em 30 s.');
  expect(await page.evaluate(() => (window as unknown as { __anuncios: string[] }).__anuncios)).toEqual([
    'Muitas tentativas. Tente de novo em 30 s.',
  ]);
  // A contagem que anda não está dentro de região viva nenhuma.
  expect(await espera.evaluate((e) => e.closest('[role="status"], [role="alert"], [role="log"], [aria-live]'))).toBeNull();
  // A espera acabou: o texto sai da região viva também (não fica um "30 s" velho).
  await page.clock.runFor(20_000);
  await expect(espera).toHaveCount(0);
  await expect(vivas).toHaveCount(0);
});

test('a double Enter sends one adminLogin and waits for its answer', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-22T10:00:00-03:00') });
  await abrir(page, 'principal');
  await page.keyboard.press('Control+KeyP');
  const senha = dialogo(page).getByLabel('Senha', { exact: true });
  const entrar = dialogo(page).getByRole('button', { name: 'Entrar' });
  await senha.fill('errada-1');
  // O relógio parado: a resposta do C++ (falso) não chega entre os dois Enter.
  await page.clock.pauseAt(new Date('2026-10-22T10:05:00-03:00'));
  await senha.press('Enter');
  await senha.press('Enter');
  expect(await vezes(page, { cmd: 'adminLogin', senha: 'errada-1' })).toBe(1);
  // Esperando a resposta: o Entrar travado.
  await expect(entrar).toBeDisabled();
  await page.clock.runFor(100);
  await expect(dialogo(page).getByRole('alert')).toHaveText('Senha incorreta.');
  await expect(senha).toHaveValue('');
  // Respondida: a próxima tentativa vale de novo.
  await page.clock.resume();
  await senha.fill('errada-2');
  await expect(entrar).toBeEnabled();
  expect((await comandos(page)).filter((c) => c.cmd === 'adminLogin')).toHaveLength(1);
});

for (const tema of ['light', 'dark'] as const) {
  test.describe(`a área do administrador (${tema})`, () => {
    test.use({ colorScheme: tema });

    test('admin screen hides Nao perturbe and Atender automatico', async ({ page }) => {
      // O Não perturbe ligado: esconder o botão também o desliga (o C++ falso faz como o de verdade).
      await abrir(page, 'nao-perturbe');
      await entrarNaAdmin(page);
      await verTextos(page, [
        'Starsonic Phone · Administrador',
        'Starsonic',
        'Área do administrador',
        'Botões da tela principal',
        'Não perturbe',
        'Desligado: o botão some e ninguém liga o Não perturbe.',
        'Atender automático',
        'Desligado: o botão some da tela principal.',
        'Atalhos',
        'BLF nos atalhos',
        'Mostra se cada ramal está livre, ocupado ou tocando. O servidor precisa ter o BLF ligado.',
        'Puxar ligação pelo atalho',
        'Clicar num ramal tocando atende a ligação dele.',
        'Código para puxar a ligação',
        'Depende da central do cliente. {ramal} vira o número do ramal que está tocando (ex.: **2007 ou *8).',
        'Servidores',
        'starcloud-starsonic.com.br',
        'Porta 5060 · UDP e TCP',
        'starcloud1-starsonic.com.br',
        'Porta 35060 · UDP e TCP',
        'Outros servidores · porta 5060',
        'Adicionar servidor',
        'Atualizações',
        'Canal',
        'Teste',
        'Estável',
        'Sair da área do administrador',
      ]);
      const dnd = page.getByRole('switch', { name: 'Não perturbe' });
      const auto = page.getByRole('switch', { name: 'Atender automático' });
      await expect(dnd).toHaveAttribute('aria-checked', 'true');
      await expect(dnd).toHaveAccessibleDescription('Desligado: o botão some e ninguém liga o Não perturbe.');
      await expect(auto).toHaveAttribute('aria-checked', 'true');
      await expect(auto).toHaveAccessibleDescription('Desligado: o botão some da tela principal.');
      await semViolacoesSerias(page);
      await capturar(page, 'admin', nomeDoTema(tema));

      await dnd.click();
      await esperarComando(page, { cmd: 'adminSet', naoPerturbe: false });
      await expect(dnd).toHaveAttribute('aria-checked', 'false');
      await auto.click();
      await esperarComando(page, { cmd: 'adminSet', atenderAuto: false });
      await expect(auto).toHaveAttribute('aria-checked', 'false');

      // A tela principal: os dois botões somem, e o Não perturbe que estava ligado foi desligado (bolinha verde).
      await page.getByRole('button', { name: 'Voltar' }).click();
      await expect(page.getByRole('textbox', { name: 'Número' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Não perturbe', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Atender automático', exact: true })).toHaveCount(0);
      await expect(page.locator('header .account .account-sub')).toHaveText('Conectado · starcloud1-starsonic.com.br');
      for (const [w, h, layout] of [
        [340, 560, 'compacto'],
        [300, 440, 'minimo'],
      ] as Array<[number, number, string]>) {
        await page.setViewportSize({ width: w, height: h });
        await expect(page.locator(`.win[data-layout="${layout}"]`)).toHaveCount(1);
        await expect(page.getByRole('button', { name: 'Não perturbe', exact: true }), layout).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Atender automático', exact: true }), layout).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Menu' }), layout).toBeVisible();
      }
      // De volta ao Normal (o layout troca depois do tamanho: o Menu muda de lugar).
      await page.setViewportSize({ width: 400, height: 720 });
      await expect(page.locator('.win[data-layout="normal"]')).toHaveCount(1);
      // Nas Configurações, o Atender automaticamente e o tempo somem; o resto fica.
      await page.getByRole('button', { name: 'Menu' }).click();
      await page.getByRole('menuitem', { name: 'Configurações' }).click();
      await expect(page.getByRole('switch', { name: 'Iniciar com o Windows' })).toBeVisible();
      await expect(page.getByRole('switch', { name: 'Bipe quando a ligação cai ou termina' })).toBeVisible();
      await expect(page.getByText('Atender automaticamente')).toHaveCount(0);
      await expect(page.getByLabel('Tempo para atender')).toHaveCount(0);

      // Mostrar de novo: os botões voltam, desligados.
      await page.getByRole('button', { name: 'Voltar' }).click();
      await page.keyboard.press('Control+KeyP');
      await expect(telaAdmin(page)).toBeVisible();
      await page.getByRole('switch', { name: 'Não perturbe' }).click();
      await esperarComando(page, { cmd: 'adminSet', naoPerturbe: true });
      await page.getByRole('switch', { name: 'Atender automático' }).click();
      await esperarComando(page, { cmd: 'adminSet', atenderAuto: true });
      await page.getByRole('button', { name: 'Voltar' }).click();
      await expect(page.getByRole('button', { name: 'Não perturbe', exact: true })).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByRole('button', { name: 'Atender automático', exact: true })).toHaveAttribute('aria-pressed', 'false');
    });
  });
}

test.describe('a tela do administrador', () => {
  test('sets BLF, pickup and its code, the servers and the channel, and leaves', async ({ page }) => {
    await abrir(page, 'principal');
    await entrarNaAdmin(page);
    const blf = page.getByRole('switch', { name: 'BLF nos atalhos' });
    await expect(blf).toHaveAttribute('aria-checked', 'true');
    await blf.click();
    await esperarComando(page, { cmd: 'adminSet', blf: false });
    await expect(blf).toHaveAttribute('aria-checked', 'false');
    const puxar = page.getByRole('switch', { name: 'Puxar ligação pelo atalho' });
    await expect(puxar).toHaveAttribute('aria-checked', 'false');
    await puxar.click();
    await esperarComando(page, { cmd: 'adminSet', puxar: true });
    await expect(puxar).toHaveAttribute('aria-checked', 'true');

    // O código vai quando a pessoa termina de digitar (Enter ou ao sair do campo), uma vez.
    const codigo = page.getByLabel('Código para puxar a ligação');
    await expect(codigo).toHaveValue('');
    await codigo.fill('**{ramal}');
    await page.waitForTimeout(200);
    expect((await comandos(page)).filter((c) => c.cmd === 'adminSet' && 'codigoPuxar' in c)).toEqual([]);
    await codigo.press('Enter');
    await esperarComando(page, { cmd: 'adminSet', codigoPuxar: '**{ramal}' });
    await codigo.blur();
    await page.waitForTimeout(200);
    expect((await comandos(page)).filter((c) => c.cmd === 'adminSet' && 'codigoPuxar' in c)).toHaveLength(1);
    // Um código que o C++ recusa: o motivo vem no toast e o campo fica com o que foi digitado.
    await codigo.fill('**{r}');
    await codigo.blur();
    await esperarComando(page, { cmd: 'adminSet', codigoPuxar: '**{r}' });
    await expect(page.getByText('O código só pode ter dígitos, *, #, + e {ramal}.', { exact: true })).toBeVisible();
    await expect(codigo).toHaveValue('**{r}');

    // Os servidores: editar a porta.
    await page.getByRole('button', { name: 'Editar o servidor starcloud1-starsonic.com.br' }).click();
    const endereco = page.getByLabel('Endereço', { exact: true });
    const porta = page.getByLabel('Porta', { exact: true });
    await expect(endereco).toHaveValue('starcloud1-starsonic.com.br');
    await expect(porta).toHaveValue('35060');
    await semViolacoesSerias(page);
    await porta.fill('35061');
    await page.getByRole('button', { name: 'Salvar servidor' }).click();
    await esperarComando(page, { cmd: 'adminSet', servidores: [SERVIDORES[0], { endereco: 'starcloud1-starsonic.com.br', porta: 35061 }] });
    await expect(endereco).toHaveCount(0);
    await verTextos(page, ['Porta 35061 · UDP e TCP']);
    // Adicionar um no fim.
    await page.getByRole('button', { name: 'Adicionar servidor' }).click();
    await expect(endereco).toBeFocused();
    await expect(endereco).toHaveValue('');
    await endereco.fill('pabx.cliente.com.br');
    await porta.fill('5080');
    await page.getByRole('button', { name: 'Salvar servidor' }).click();
    const tres = [SERVIDORES[0], { endereco: 'starcloud1-starsonic.com.br', porta: 35061 }, { endereco: 'pabx.cliente.com.br', porta: 5080 }];
    await esperarComando(page, { cmd: 'adminSet', servidores: tres });
    await verTextos(page, ['pabx.cliente.com.br', 'Porta 5080 · UDP e TCP']);
    // Um repetido: o C++ recusa com o toast, e o formulário continua com o que foi digitado.
    await page.getByRole('button', { name: 'Adicionar servidor' }).click();
    // O formulário põe o foco no Endereço depois de aparecer: antes de digitar, o foco já chegou lá.
    await expect(endereco).toBeFocused();
    await endereco.fill('starcloud-starsonic.com.br');
    await porta.fill('5070');
    await page.getByRole('button', { name: 'Salvar servidor' }).click();
    await expect(page.getByText('Esse servidor já está na lista.', { exact: true })).toBeVisible();
    await expect(endereco).toHaveValue('starcloud-starsonic.com.br');
    await expect(porta).toHaveValue('5070');
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(endereco).toHaveCount(0);
    // Remover.
    await page.getByRole('button', { name: 'Editar o servidor pabx.cliente.com.br' }).click();
    await page.getByRole('button', { name: 'Remover' }).click();
    await esperarComando(page, { cmd: 'adminSet', servidores: tres.slice(0, 2) });
    await expect(page.getByText('pabx.cliente.com.br', { exact: true })).toHaveCount(0);
    // A porta só com dígitos; sem o endereço ou a porta, nada a salvar.
    await page.getByRole('button', { name: 'Adicionar servidor' }).click();
    await expect(endereco).toBeFocused();
    await porta.fill('50a6');
    await expect(porta).toHaveValue('506');
    await expect(page.getByRole('button', { name: 'Salvar servidor' })).toBeDisabled();
    await page.getByRole('button', { name: 'Cancelar' }).click();
    // "Outros servidores" fica embaixo da lista, sem Editar.
    await expect(page.getByText('Outros servidores · porta 5060', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Editar o servidor/ })).toHaveCount(2);

    // O canal: "" (o do build) aparece como Teste; Estável e Teste mandam o canal.
    const teste = page.getByRole('radio', { name: 'Teste' });
    const estavel = page.getByRole('radio', { name: 'Estável' });
    await expect(teste).toBeChecked();
    await estavel.check();
    await esperarComando(page, { cmd: 'adminSet', canal: 'estavel' });
    await expect(estavel).toBeChecked();
    await teste.check();
    await esperarComando(page, { cmd: 'adminSet', canal: 'teste' });
    await expect(teste).toBeChecked();

    // Sair: a área fecha e a tela principal volta; o Ctrl + P pede a senha de novo.
    await page.getByRole('button', { name: 'Sair da área do administrador' }).click();
    await esperarComando(page, { cmd: 'adminLogout' });
    await expect(page.getByRole('textbox', { name: 'Número' })).toBeVisible();
    await page.keyboard.press('Control+KeyP');
    await expect(dialogo(page)).toBeVisible();
  });

  test('leaves when the C++ closes the area (ten idle minutes)', async ({ page }) => {
    await abrir(page, 'principal');
    await entrarNaAdmin(page);
    await mudarEstado(page, (s) => ({ ...s, admin: { aberto: false, naoPerturbe: true, atenderAuto: true, blf: true } }));
    await expect(telaAdmin(page)).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Número' })).toBeVisible();
  });
});

// O foco da tela do administrador (C-M2): ao abrir (pela senha e pelo Ctrl + P) vai ao título da tela, e o leitor de
// tela diz onde a pessoa está; o formulário de servidor devolve o foco ao Editar da linha ou ao "Adicionar servidor"
// que o abriu (o foco caía no <body>).
test.describe('o foco da tela do administrador', () => {
  const editar = (page: Page) => page.getByRole('button', { name: 'Editar o servidor starcloud1-starsonic.com.br' });
  const adicionar = (page: Page) => page.getByRole('button', { name: 'Adicionar servidor' });
  const endereco = (page: Page) => page.getByLabel('Endereço', { exact: true });
  const porta = (page: Page) => page.getByLabel('Porta', { exact: true });

  test('the screen focuses its title when it opens, by the password and by Ctrl + P', async ({ page }) => {
    await abrir(page, 'principal');
    await entrarNaAdmin(page);
    await expect(telaAdmin(page), 'depois da senha').toBeFocused();
    await page.getByRole('button', { name: 'Voltar' }).click();
    await expect(page.getByRole('textbox', { name: 'Número' })).toBeVisible();
    // Com a área aberta, o Ctrl + P vai direto para a tela, e o foco também (de novo, na mesma sessão).
    await page.keyboard.press('Control+KeyP');
    await expect(telaAdmin(page)).toBeVisible();
    await expect(telaAdmin(page), 'pelo Ctrl + P').toBeFocused();
  });

  test('the server form gives the focus back to the Editar or the Adicionar servidor that opened it', async ({ page }) => {
    await abrir(page, 'principal');
    await entrarNaAdmin(page);
    // Editar: Cancelar e Salvar voltam ao Editar da linha.
    await editar(page).click();
    await expect(endereco(page)).toBeFocused();
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(endereco(page)).toHaveCount(0);
    await expect(editar(page), 'Cancelar').toBeFocused();
    await editar(page).click();
    await porta(page).fill('35061');
    await page.getByRole('button', { name: 'Salvar servidor' }).click();
    await expect(page.getByText('Porta 35061 · UDP e TCP', { exact: true })).toBeVisible();
    await expect(editar(page), 'Salvar').toBeFocused();
    // Adicionar servidor: Cancelar e Salvar voltam a ele.
    await adicionar(page).click();
    await expect(endereco(page)).toBeFocused();
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(adicionar(page), 'Cancelar o novo').toBeFocused();
    await adicionar(page).click();
    await endereco(page).fill('pabx.cliente.com.br');
    await porta(page).fill('5080');
    await page.getByRole('button', { name: 'Salvar servidor' }).click();
    await expect(page.getByText('pabx.cliente.com.br', { exact: true })).toBeVisible();
    await expect(adicionar(page), 'Salvar o novo').toBeFocused();
  });

  test('the form closing after a slow save does not take the focus from where the person moved it', async ({ page }) => {
    await abrir(page, 'principal');
    await entrarNaAdmin(page);
    await editar(page).click();
    await porta(page).fill('35061');
    await segurarCpp(page);
    await page.getByRole('button', { name: 'Salvar servidor' }).click();
    await esperarComando(page, { cmd: 'adminSet', servidores: [SERVIDORES[0], { endereco: 'starcloud1-starsonic.com.br', porta: 35061 }] });
    // O C++ ainda não respondeu: a pessoa foi para a chave do BLF. O formulário fecha quando a resposta chega, e o foco fica onde ela o pôs.
    const blf = page.getByRole('switch', { name: 'BLF nos atalhos' });
    await blf.focus();
    await soltarCpp(page);
    await expect(page.getByText('Porta 35061 · UDP e TCP', { exact: true })).toBeVisible();
    await expect(blf).toBeFocused();
  });
});
