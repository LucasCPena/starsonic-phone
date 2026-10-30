// O modo iPhone da interface (spec do iPhone, seções 8 e 11.2; docs/ponte-windows.md, "O modo iPhone"), contra a ponte
// falsa no modo iPhone (?plataforma=ios), em cada tamanho do iPhone e nos dois temas: sem a barra de título e sem as
// partes do PC, com a área segura, o axe e as fotos (test-results/capturas/ios-*.png) que vão ao responsável.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { audio, audioFalso, comandos, empurrar, esperarComando } from './helpers';
import { abrirIos, capturarIos, dentroDaAreaSegura, noIphone, semViolacoesSerias, TAMANHOS_IPHONE } from './ios-helpers';

const APP_CSS = fileURLToPath(new URL('../dist/app.css', import.meta.url));
/** A conta em uso dos cenários: a Recepção, 2001. */
const CONTA_EM_USO = '9f3c2a71b0d84e55';
const VIEWPORT_DO_IPHONE = 'width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1';

for (const tamanho of TAMANHOS_IPHONE) {
  for (const tema of ['light', 'dark'] as const) {
    test.describe(`iPhone ${tamanho.largura}×${tamanho.altura} (${tema})`, () => {
      test.use({ ...noIphone(tamanho), colorScheme: tema });

      test('the main screen has no title bar, no Atalhos tab and keeps the safe area', async ({ page }) => {
        await abrirIos(page, 'principal', tamanho);
        await expect(page.locator('.titlebar')).toHaveCount(0);
        await expect(page.locator('.resize-zone')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Atalhos' })).toHaveCount(0);
        await expect(page.locator('.nav button')).toHaveCount(3);
        await expect(page.locator('.win')).toHaveAttribute('data-plataforma', 'ios');
        // Teclado, Recentes e Contatos, sem as teclas do PC, em três colunas de ponta a ponta (e sem o desenho do canto
        // de redimensionar).
        const nav = page.getByRole('navigation', { name: 'Seções' });
        const abas = await nav.locator('button.tab').evaluateAll((bs) => bs.map((b) => [b.getAttribute('aria-label'), b.getAttribute('aria-keyshortcuts')]));
        expect(abas).toEqual([
          ['Teclado', null],
          ['Recentes', null],
          ['Contatos', null],
        ]);
        const colunas = await nav.evaluate((n) => {
          const s = getComputedStyle(n);
          const r = n.getBoundingClientRect();
          const bs = Array.from(n.querySelectorAll('button.tab'), (b) => b.getBoundingClientRect());
          return { inicio: r.left + parseFloat(s.paddingLeft), fim: r.right - parseFloat(s.paddingRight), primeira: bs[0].left, ultima: bs[2].right };
        });
        expect(colunas.primeira).toBeCloseTo(colunas.inicio, 0);
        expect(colunas.ultima).toBeCloseTo(colunas.fim, 0);
        await expect(nav.locator('.grip')).toBeHidden();
        await dentroDaAreaSegura(page, ['.brand', '.nav']);
        // A página até as bordas da tela e sem zoom, e o toque sem o que é do navegador: a seleção de texto fora dos campos,
        // o realce do toque e o zoom de dois toques (o menu do toque longo é o caso do app.css, no fim).
        await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', VIEWPORT_DO_IPHONE);
        const toque = (seletor: string) =>
          page.locator(seletor).first().evaluate((e) => {
            const s = getComputedStyle(e);
            return [s.userSelect, s.touchAction, s.getPropertyValue('-webkit-tap-highlight-color')];
          });
        expect(await toque('.key')).toEqual(['none', 'manipulation', 'rgba(0, 0, 0, 0)']);
        expect(await toque('.account-name')).toEqual(['none', 'manipulation', 'rgba(0, 0, 0, 0)']);
        expect((await toque('input.number-text'))[0]).toBe('text');
        await semViolacoesSerias(page);
        await capturarIos(page, 'teclado', tamanho, tema);
      });

      test('the menu has Configurações, Editar conta, Sobre and Sair, and Sair asks before removeAccount', async ({ page }) => {
        await abrirIos(page, 'principal', tamanho);
        const abrirMenu = async () => {
          await page.getByRole('button', { name: 'Menu' }).click();
          return page.getByRole('menu', { name: 'Menu' });
        };
        let menu = await abrirMenu();
        await expect(menu.getByRole('menuitem')).toHaveText(['Configurações', 'Editar conta', 'Sobre', 'Sair']);
        // A linha de separar fica antes do Sair.
        expect(await menu.evaluate((m) => Array.from(m.children, (c) => c.getAttribute('role')))).toEqual([
          'menuitem',
          'menuitem',
          'menuitem',
          'separator',
          'menuitem',
        ]);

        // Editar conta: a tela da conta em uso, preenchida.
        await menu.getByRole('menuitem', { name: 'Editar conta' }).click();
        await expect(page.getByRole('heading', { name: 'Editar conta' })).toBeVisible();
        await expect(page.getByLabel('Servidor (endereço ou IP)')).toHaveValue('starcloud1-starsonic.com.br');
        await expect(page.getByLabel('Ramal', { exact: true })).toHaveValue('2001');
        await expect(page.getByLabel('Nome da conta (opcional)')).toHaveValue('Recepção');
        await page.getByRole('button', { name: 'Voltar' }).click();

        // O Sair pergunta antes; o Cancelar não manda nada e devolve o foco ao Menu.
        menu = await abrirMenu();
        await menu.getByRole('menuitem', { name: 'Sair' }).click();
        const dialogo = page.getByRole('dialog', { name: 'Sair da conta?' });
        await expect(dialogo).toBeVisible();
        await expect(
          dialogo.getByText('Este iPhone deixa de receber as ligações do ramal. Para entrar de novo, você vai precisar da senha.', { exact: true }),
        ).toBeVisible();
        await expect(dialogo.getByRole('button')).toHaveText(['Cancelar', 'Sair']);
        await dentroDaAreaSegura(page, ['dialog[open]']);
        await semViolacoesSerias(page);
        await dialogo.getByRole('button', { name: 'Cancelar' }).click();
        await expect(dialogo).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Menu' })).toBeFocused();
        expect((await comandos(page)).filter((c) => c.cmd === 'removeAccount' || c.cmd === 'quit')).toEqual([]);

        // O Sair da confirmação: o removeAccount da conta em uso (nunca o quit); o C++ de mentira volta à tela Entrar.
        menu = await abrirMenu();
        await menu.getByRole('menuitem', { name: 'Sair' }).click();
        await dialogo.getByRole('button', { name: 'Sair' }).click();
        await esperarComando(page, { cmd: 'removeAccount', contaId: CONTA_EM_USO });
        await expect(page.getByRole('heading', { name: 'Entre com o seu ramal' })).toBeVisible();
        expect((await comandos(page)).filter((c) => c.cmd === 'quit')).toEqual([]);
      });

      test('the account in the header does not switch accounts', async ({ page }) => {
        await abrirIos(page, 'principal', tamanho);
        const conta = page.locator('.brand .account');
        await expect(conta).toContainText('2001');
        await expect(conta).toContainText('Conectado · starcloud1-starsonic.com.br');
        await expect(page.getByRole('button', { name: /Trocar de conta/ })).toHaveCount(0);
        // Sem a seta.
        await expect(conta.locator('svg')).toHaveCount(0);
        await conta.click();
        await expect(page.getByRole('menu')).toHaveCount(0);
        await expect(page.getByText('Adicionar conta')).toHaveCount(0);
        expect((await comandos(page)).filter((c) => c.cmd === 'selectAccount')).toEqual([]);
      });

      test('Entrar calls the support number and keeps the safe area', async ({ page }) => {
        await abrirIos(page, 'entrar', tamanho);
        await expect(page.locator('.titlebar')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Fechar' })).toHaveCount(0);
        // O número da ajuda é um botão: o toque abre o discador do iPhone.
        const ligar = page.getByRole('button', { name: 'Ligar para (11) 5060-3000' });
        await expect(ligar).toHaveText('(11) 5060-3000');
        await expect(page.getByText('Precisa de ajuda? (11) 5060-3000', { exact: true })).toBeVisible();
        await dentroDaAreaSegura(page, ['.brand', 'form']);
        await semViolacoesSerias(page);
        await capturarIos(page, 'entrar', tamanho, tema);
        await ligar.click();
        await esperarComando(page, { cmd: 'openExternal', url: 'tel:+551150603000' });
      });

      test('Recentes has no Salvar contato', async ({ page }) => {
        await abrirIos(page, 'recentes', tamanho);
        await esperarComando(page, { cmd: 'viewRecents' });
        await expect(page.getByRole('button', { name: 'Recentes' })).toHaveAttribute('aria-current', 'page');
        await expect(page.getByText('Perdida · 14:32', { exact: true })).toBeVisible();
        await dentroDaAreaSegura(page, ['.brand', '.nav']);
        await semViolacoesSerias(page);
        await capturarIos(page, 'recentes', tamanho, tema);
        // Tocar numa linha (aqui, um número sem nome) abre só o Ligar.
        await page.getByRole('button', { name: /^3001/ }).click();
        const acoes = page.locator('.row-actions');
        await expect(acoes.getByRole('button')).toHaveText(['Ligar']);
        await expect(page.getByRole('button', { name: 'Salvar contato' })).toHaveCount(0);
        await acoes.getByRole('button', { name: 'Ligar' }).click();
        await esperarComando(page, { cmd: 'dial', numero: '3001' });
      });

      test('ring and update messages do nothing, and Ctrl+P and Ctrl+2 do nothing', async ({ page }) => {
        await audioFalso(page);
        await abrirIos(page, 'principal', tamanho);
        await empurrar(page, { v: 1, type: 'ring', tipo: 'completo' });
        await empurrar(page, { v: 1, type: 'update', versao: '1.0.1', notas: 'Correções no Teclado.' });
        // Um aviso depois dos dois: as mensagens chegam na ordem, e o aviso na tela diz que as duas já passaram.
        await empurrar(page, { v: 1, type: 'toast', texto: 'Sem conexão com o servidor. Tente de novo em instantes.' });
        await expect(page.getByText('Sem conexão com o servidor. Tente de novo em instantes.')).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(await audio(page), 'nenhum toque').toEqual([]);
        // As teclas do PC não fazem nada: o 5 que vem depois delas chega ao Teclado, que continua na tela.
        await page.keyboard.press('Control+KeyP');
        await page.keyboard.press('Control+2');
        await page.keyboard.press('5');
        await expect(page.getByRole('textbox', { name: 'Número' })).toHaveValue('5');
        await expect(page.getByRole('button', { name: 'Teclado' })).toHaveAttribute('aria-current', 'page');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect((await comandos(page)).filter((c) => ['adminLogin', 'updateNow', 'updateLater'].includes(String(c.cmd)))).toEqual([]);
      });

      test('the abrir message opens Recentes', async ({ page }) => {
        await abrirIos(page, 'principal', tamanho);
        const recentes = page.getByRole('button', { name: 'Recentes' });
        // Do Teclado.
        await empurrar(page, { v: 1, type: 'abrir', tela: 'recentes' });
        await expect(page.getByRole('main', { name: 'Recentes' })).toBeVisible();
        await expect(recentes).toHaveAttribute('aria-current', 'page');
        await esperarComando(page, { cmd: 'viewRecents' });
        // De Configurações.
        await page.getByRole('button', { name: 'Menu' }).click();
        await page.getByRole('menuitem', { name: 'Configurações' }).click();
        await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
        await empurrar(page, { v: 1, type: 'abrir', tela: 'recentes' });
        await expect(page.getByRole('main', { name: 'Recentes' })).toBeVisible();
        await expect(recentes).toHaveAttribute('aria-current', 'page');
      });
    });
  }
}

// O menu do toque longo (o -webkit-touch-callout) é só do WebKit: o Chromium dos testes não o tem no estilo calculado, e
// o caso confere a regra no app.css. Ela vale só no modo iPhone, como o resto.
test('the iPhone styles turn off the long-press menu, and only in the iPhone mode', () => {
  const css = readFileSync(APP_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const regras = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g), ([, seletor, corpo]) => ({ seletor: seletor.trim(), corpo }));
  const callout = regras.filter((r) => /-webkit-touch-callout/.test(r.corpo));
  expect(callout.some((r) => /-webkit-touch-callout:\s*none/.test(r.corpo))).toBe(true);
  for (const parte of callout.flatMap((r) => r.seletor.split(','))) expect(parte.trim()).toMatch(/^\.win\[data-plataforma="ios"\]/);
});
