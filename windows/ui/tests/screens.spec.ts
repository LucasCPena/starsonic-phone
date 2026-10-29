// As telas fora da ligação (Entrar, Teclado, Recentes, Contatos, Configurações e Sobre) contra a ponte falsa,
// nos temas claro e escuro: os textos exatos, os comandos que saem, o axe e uma captura por tela e tema.
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const CAPTURAS = fileURLToPath(new URL('../test-results/capturas/', import.meta.url));

type Comando = Record<string, unknown>;

async function abrir(page: Page, cenario: string): Promise<void> {
  await page.goto(`/index.html?fake=${cenario}`);
  await expect(page.locator('body[data-pronto]')).toHaveCount(1);
}

async function comandos(page: Page): Promise<Comando[]> {
  return page.evaluate(() => (window as unknown as { __comandos: Comando[] }).__comandos);
}

async function esperarComando(page: Page, esperado: Comando): Promise<void> {
  await expect.poll(() => comandos(page)).toContainEqual({ v: 1, ...esperado });
}

async function empurrar(page: Page, mensagem: unknown): Promise<void> {
  await page.evaluate((m) => (window as unknown as { __fake: { push(m: unknown): void } }).__fake.push(m), mensagem);
}

async function mudarEstado(page: Page, mudar: (s: Record<string, any>) => Record<string, any>): Promise<void> {
  const atual = await page.evaluate(() => (window as unknown as { __fake: { state(): Record<string, any> } }).__fake.state());
  await empurrar(page, { v: 1, type: 'state', state: mudar(atual) });
}

async function verTextos(page: Page, textos: string[]): Promise<void> {
  for (const texto of textos) {
    await expect(page.getByText(texto, { exact: true }).first(), texto).toBeVisible();
  }
}

async function semViolacoesSerias(page: Page): Promise<void> {
  const resultado = await new AxeBuilder({ page }).analyze();
  const serias = resultado.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ regra: v.id, impacto: v.impact, onde: v.nodes.map((n) => n.target.join(' ')) }));
  expect(serias, JSON.stringify(serias, null, 2)).toEqual([]);
}

async function capturar(page: Page, nome: string, tema: string): Promise<void> {
  mkdirSync(CAPTURAS, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  // O ponteiro na barra de título: nenhum botão em hover na captura.
  await page.mouse.move(200, 10);
  await page.screenshot({ path: join(CAPTURAS, `${nome}-${tema}.png`) });
}

for (const tema of ['light', 'dark'] as const) {
  test.describe(`tema ${tema}`, () => {
    test.use({ colorScheme: tema });

    test('the update question shows the version and the notes and answers updateNow', async ({ page }) => {
      await abrir(page, 'principal');
      await empurrar(page, { v: 1, type: 'update', versao: '0.1.0-rc.2', notas: 'Correções no aviso de ligação.' });
      const dialogo = page.getByRole('dialog', { name: 'Atualização' });
      await expect(dialogo).toBeVisible();
      await verTextos(page, [
        'Atualização',
        'Nova versão do Starsonic Phone disponível (0.1.0-rc.2). Atualizar agora?',
        'Correções no aviso de ligação.',
        'Depois',
        'Atualizar agora',
      ]);
      await semViolacoesSerias(page);
      await capturar(page, 'atualizacao', tema);
      await dialogo.getByRole('button', { name: 'Atualizar agora' }).click();
      await esperarComando(page, { cmd: 'updateNow' });
      await expect(dialogo).toHaveCount(0);
      expect((await comandos(page)).filter((c) => c.cmd === 'updateLater')).toEqual([]);
    });

    test('Entrar shows the exact texts and sends login with the fields', async ({ page }) => {
      await abrir(page, 'entrar');
      await verTextos(page, [
        'Starsonic Phone',
        'Ramal no computador',
        'Entre com o seu ramal',
        'Servidor (endereço ou IP)',
        'Protocolo',
        'UDP',
        'TCP',
        'Ramal',
        'Senha',
        'Nome da conta (opcional)',
        'Entrar',
        '(11) 5060-3000',
      ]);
      await expect(page.getByText('Precisa de ajuda?')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Fechar' })).toBeVisible();
      await semViolacoesSerias(page);
      await capturar(page, 'entrar', tema);

      await page.getByLabel('Servidor (endereço ou IP)').fill('starcloud1-starsonic.com.br');
      await page.getByRole('radio', { name: 'TCP' }).check();
      await page.getByLabel('Ramal', { exact: true }).fill('2001');
      await page.getByLabel('Senha', { exact: true }).fill('segredo');
      await page.getByRole('button', { name: 'Mostrar a senha' }).click();
      await expect(page.getByLabel('Senha', { exact: true })).toHaveAttribute('type', 'text');
      await page.getByLabel('Nome da conta (opcional)').fill('Recepção');
      await page.getByRole('button', { name: 'Entrar' }).click();
      await esperarComando(page, {
        cmd: 'login',
        servidor: 'starcloud1-starsonic.com.br',
        protocolo: 'tcp',
        ramal: '2001',
        senha: 'segredo',
        nome: 'Recepção',
      });
      // O C++ falso registra: "Conectando…" e depois a tela principal.
      await expect(page.getByRole('button', { name: 'Conectando…' })).toBeDisabled();
      await expect(page.getByRole('navigation', { name: 'Seções' })).toBeVisible();
    });

    test('Entrar shows the error under the password and keeps the fields', async ({ page }) => {
      await abrir(page, 'entrar-erro');
      await verTextos(page, ['Ramal ou senha incorretos.']);
      await expect(page.getByLabel('Servidor (endereço ou IP)')).toHaveValue('starcloud1-starsonic.com.br');
      await expect(page.getByLabel('Ramal', { exact: true })).toHaveValue('2001');
      await expect(page.getByLabel('Nome da conta (opcional)')).toHaveValue('Recepção');
      const senha = page.getByLabel('Senha', { exact: true });
      await expect(senha).toHaveValue('');
      await expect(senha).toHaveAttribute('aria-invalid', 'true');
      await expect(senha).toHaveAccessibleDescription('Ramal ou senha incorretos.');
      await semViolacoesSerias(page);
      await capturar(page, 'entrar-erro', tema);

      // O número da ajuda é texto (o app é o tratador do tel:, e o link só encheria o Teclado escondido): selecionável,
      // sem link e sem comando.
      await expect(page.getByText('Precisa de ajuda? (11) 5060-3000', { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: '(11) 5060-3000' })).toHaveCount(0);
      const numero = page.getByText('(11) 5060-3000', { exact: true });
      expect(await numero.evaluate((e) => getComputedStyle(e).userSelect)).not.toBe('none');
      await numero.click();
      await page.waitForTimeout(300);
      expect((await comandos(page)).filter((c) => c.cmd === 'openExternal')).toEqual([]);
    });

    test('a switch to an account without its password asks for it with Cancelar back to the account in use', async ({ page }) => {
      await abrir(page, 'troca-pede-senha');
      await verTextos(page, ['Digite a senha de novo para continuar.', 'Entrar', 'Cancelar']);
      await expect(page.getByLabel('Servidor (endereço ou IP)')).toHaveValue('starcloud-starsonic.com.br');
      await expect(page.getByLabel('Ramal', { exact: true })).toHaveValue('2015');
      await expect(page.getByLabel('Senha', { exact: true })).toBeFocused();
      await semViolacoesSerias(page);
      await capturar(page, 'entrar-troca-pede-senha', tema);
      await page.getByRole('button', { name: 'Cancelar' }).click();
      await esperarComando(page, { cmd: 'cancelLogin' });
      // O C++ falso volta para a conta em uso: a tela principal, com ela no cabeçalho.
      await expect(page.getByRole('navigation', { name: 'Seções' })).toBeVisible();
      await expect(page.getByText('Conectado · starcloud1-starsonic.com.br').first()).toBeVisible();
      expect((await comandos(page)).filter((c) => c.cmd === 'login')).toEqual([]);
    });

    test('a call on the account in use shows over the password request of a switch, and Entrar comes back after it', async ({ page }) => {
      await abrir(page, 'troca-pede-senha');
      await expect(page.getByRole('button', { name: 'Cancelar' })).toBeVisible();
      // A conta em uso continua registrada: uma ligação chega (mesmo com a tela ainda "entrar" no estado, a ligação
      // vem antes).
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
      const atender = page.getByRole('button', { name: 'Atender', exact: true });
      await expect(atender).toBeVisible();
      await expect(page.getByLabel('Senha', { exact: true })).toHaveCount(0);
      await atender.click();
      await esperarComando(page, { cmd: 'answer' });
      const desligar = page.getByRole('button', { name: 'Desligar', exact: true });
      await expect(desligar).toBeVisible();
      await desligar.click();
      await esperarComando(page, { cmd: 'hangup', id: 31 });
      // A ligação acabou: a troca ainda pede a senha, com o Cancelar.
      await expect(page.getByLabel('Senha', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Cancelar' })).toBeVisible();
      await verTextos(page, ['Digite a senha de novo para continuar.']);
    });

    test('Entrar asks again for the password of a migrated account', async ({ page }) => {
      await abrir(page, 'entrar-pede-senha');
      await verTextos(page, ['Digite a senha de novo para continuar.']);
      await expect(page.getByLabel('Servidor (endereço ou IP)')).toHaveValue('starcloud1-starsonic.com.br');
      await expect(page.getByRole('radio', { name: 'TCP' })).toBeChecked();
      await expect(page.getByLabel('Ramal', { exact: true })).toHaveValue('2001');
      await expect(page.getByLabel('Nome da conta (opcional)')).toHaveValue('Recepção');
      const senha = page.getByLabel('Senha', { exact: true });
      await expect(senha).toHaveValue('');
      await expect(senha).toBeFocused();
      await expect(senha).toHaveAccessibleDescription('Digite a senha de novo para continuar.');
      await semViolacoesSerias(page);
      await capturar(page, 'entrar-pede-senha', tema);

      await page.keyboard.type('nova-senha');
      await page.getByRole('button', { name: 'Entrar' }).click();
      await esperarComando(page, {
        cmd: 'login',
        servidor: 'starcloud1-starsonic.com.br',
        protocolo: 'tcp',
        ramal: '2001',
        senha: 'nova-senha',
        nome: 'Recepção',
        contaId: '7d1e0c55a9b34f20',
      });
    });

    test('Teclado dials what is typed on the keys and on the keyboard', async ({ page }) => {
      await abrir(page, 'principal');
      await verTextos(page, [
        'Starsonic Phone',
        'Recepção · 2001',
        'Conectado · starcloud1-starsonic.com.br',
        'Não perturbe',
        'Atender automático',
        'Teclado',
        'Recentes',
        'Contatos',
        'Ligar',
      ]);
      const numero = page.getByRole('textbox', { name: 'Número' });
      for (const tecla of ['2', '0', '0', '3']) {
        await page.getByRole('button', { name: tecla, exact: true }).click();
      }
      await expect(numero).toHaveValue('2003');
      await expect(page.getByRole('button', { name: /Ana Souza/ })).toBeVisible();
      await verTextos(page, ['Contato · 2003']);
      await semViolacoesSerias(page);
      await capturar(page, 'teclado', tema);

      await page.keyboard.press('Enter');
      await esperarComando(page, { cmd: 'dial', numero: '2003' });

      // Esc limpa; o teclado físico digita com o foco fora do campo (num botão do teclado).
      await page.keyboard.press('Escape');
      await expect(numero).toHaveValue('');
      await page.keyboard.type('2004');
      await expect(numero).toHaveValue('2004');
      await page.keyboard.press('Backspace');
      await page.keyboard.type('5');
      await expect(numero).toHaveValue('2005');
      await page.getByRole('button', { name: 'Apagar' }).click();
      await expect(numero).toHaveValue('200');
      await numero.focus();
      await page.keyboard.type('3');
      await expect(numero).toHaveValue('2003');
      const antes = (await comandos(page)).filter((c) => c.cmd === 'dial').length;
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await comandos(page)).filter((c) => c.cmd === 'dial').length).toBe(antes + 1);

      // A sugestão liga para o contato (com a regra dos contatos).
      await page.getByRole('button', { name: /Ana Souza/ }).click();
      await esperarComando(page, { cmd: 'dial', numero: '2003', contato: true });
      await page.getByRole('button', { name: 'Ligar', exact: true }).click();
      expect((await comandos(page)).filter((c) => c.cmd === 'dial').length).toBe(antes + 3);
    });

    test('Ctrl+1, 2, 3 and 4 switch the tab in the nav order', async ({ page }) => {
      await abrir(page, 'principal');
      const nav = page.getByRole('navigation', { name: 'Seções' });
      // A ordem (rc.3): Teclado, Atalhos, Recentes, Contatos.
      expect(await nav.locator('button.tab').evaluateAll((bs) => bs.map((b) => [b.getAttribute('aria-label'), b.getAttribute('aria-keyshortcuts')]))).toEqual([
        ['Teclado', 'Control+1'],
        ['Atalhos', 'Control+2'],
        ['Recentes', 'Control+3'],
        ['Contatos', 'Control+4'],
      ]);
      await page.keyboard.press('Control+2');
      await expect(nav.getByRole('button', { name: 'Atalhos' })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('main', { name: 'Atalhos' })).toBeVisible();
      await page.keyboard.press('Control+3');
      await expect(nav.getByRole('button', { name: 'Recentes' })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('button', { name: 'Todas' })).toBeVisible();
      await esperarComando(page, { cmd: 'viewRecents' });
      await page.keyboard.press('Control+4');
      await expect(nav.getByRole('button', { name: 'Contatos' })).toHaveAttribute('aria-current', 'page');
      await page.keyboard.press('Control+1');
      await expect(nav.getByRole('button', { name: 'Teclado' })).toHaveAttribute('aria-current', 'page');
      await nav.getByRole('button', { name: 'Recentes' }).click();
      await expect(page.getByRole('button', { name: 'Todas' })).toBeVisible();
      await nav.getByRole('button', { name: 'Atalhos' }).click();
      await expect(page.getByRole('main', { name: 'Atalhos' })).toBeVisible();
    });

    test('the header sends Não perturbe, Atender automático, the window and the account commands', async ({ page }) => {
      await abrir(page, 'principal');
      const dnd = page.getByRole('button', { name: 'Não perturbe', exact: true });
      await expect(dnd).toHaveAttribute('aria-pressed', 'false');
      await dnd.click();
      await esperarComando(page, { cmd: 'setDnd', on: true });
      await expect(dnd).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'Atender automático' }).click();
      await esperarComando(page, { cmd: 'setAutoAnswer', on: true });

      await page.getByRole('button', { name: 'Minimizar' }).click();
      await esperarComando(page, { cmd: 'minimize' });
      await page.getByRole('button', { name: 'Fechar para a bandeja' }).click();
      await esperarComando(page, { cmd: 'closeToTray' });

      await page.getByRole('button', { name: /Trocar de conta/ }).click();
      await expect(page.getByRole('menuitemradio', { name: /Recepção · 2001/ })).toHaveAttribute('aria-checked', 'true');
      await semViolacoesSerias(page);
      await capturar(page, 'contas', tema);
      await page.getByRole('menuitemradio', { name: /Caixa 2 · 2015/ }).click();
      await esperarComando(page, { cmd: 'selectAccount', contaId: '41aa07c3d2e95b18' });
      await expect(page.getByText('Caixa 2 · 2015', { exact: true })).toBeVisible();

      await page.getByRole('button', { name: 'Menu' }).click();
      await verTextos(page, ['Configurações', 'Sobre', 'Sair']);
      // O foco chega ao primeiro item depois de o menu abrir: só então o Esc o fecha.
      await expect(page.getByRole('menu', { name: 'Menu' }).getByRole('menuitem', { name: 'Configurações' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
      await page.getByRole('button', { name: 'Menu' }).click();
      await page.getByRole('menuitem', { name: 'Sair' }).click();
      await esperarComando(page, { cmd: 'quit' });
    });

    test('Não perturbe on turns off', async ({ page }) => {
      await abrir(page, 'nao-perturbe');
      const dnd = page.getByRole('button', { name: 'Não perturbe', exact: true });
      await expect(dnd).toHaveAttribute('aria-pressed', 'true');
      await semViolacoesSerias(page);
      await capturar(page, 'nao-perturbe', tema);
      await dnd.click();
      await esperarComando(page, { cmd: 'setDnd', on: false });
    });

    test('Recentes groups by day, filters the missed calls and saves a contact', async ({ page }) => {
      await abrir(page, 'recentes');
      await esperarComando(page, { cmd: 'viewRecents' });
      await verTextos(page, [
        'Todas',
        'Perdidas · 2',
        'Hoje',
        'Ontem',
        'Ana Souza',
        'Perdida · 14:32',
        '1150603000',
        'Feita · 11:05 · 4 min 18 s',
        'Financeiro',
        'Recebida · 09:47 · 1 min 02 s',
        '3001',
        'Perdida · 17:58',
        'Carlos Lima',
        'Feita · 16:20 · 12 min 40 s',
      ]);
      await semViolacoesSerias(page);
      await capturar(page, 'recentes', tema);

      await page.getByRole('button', { name: 'Ligar para Ana Souza' }).click();
      await esperarComando(page, { cmd: 'dial', numero: '2003' });

      await page.getByRole('button', { name: 'Perdidas · 2' }).click();
      await expect(page.getByRole('button', { name: 'Perdidas · 2' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByText('Carlos Lima')).toHaveCount(0);
      await expect(page.getByText('3001', { exact: true })).toBeVisible();

      await page.getByRole('button', { name: /^3001/ }).click();
      await expect(page.getByRole('button', { name: 'Ligar', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Salvar contato' }).click();
      await expect(page.getByRole('heading', { name: 'Novo contato' })).toBeVisible();
      await expect(page.getByLabel('Número')).toHaveValue('3001');
      await page.getByLabel('Nome', { exact: true }).fill('Paula Reis');
      await page.getByRole('button', { name: 'Salvar contato' }).click();
      await esperarComando(page, { cmd: 'saveContact', nome: 'Paula Reis', numero: '3001', observacao: '' });
      await expect(page.getByRole('button', { name: 'Todas' })).toBeVisible();
    });

    test('Contatos searches, dials, adds, edits and removes', async ({ page }) => {
      await abrir(page, 'contatos');
      await expect(page.getByRole('searchbox', { name: 'Buscar contato' })).toHaveAttribute('placeholder', 'Buscar contato');
      await verTextos(page, [
        'A',
        'Ana Souza',
        'Ramal 2003 · Comercial',
        'Atendimento Starsonic',
        '(11) 5060-3000',
        'C',
        'Carlos Lima',
        'Ramal 2007 · Suporte',
        'F',
        'Financeiro',
        'Ramal 2010',
      ]);
      await expect(page.getByRole('button', { name: 'Atender automático' })).toHaveAttribute('aria-pressed', 'true');
      await semViolacoesSerias(page);
      await capturar(page, 'contatos', tema);

      await page.getByRole('button', { name: /^Ana Souza/ }).click();
      await esperarComando(page, { cmd: 'dial', numero: '2003', contato: true });
      await page.getByRole('button', { name: 'Ligar para Carlos Lima' }).click();
      await esperarComando(page, { cmd: 'dial', numero: '2007', contato: true });

      await page.getByRole('searchbox', { name: 'Buscar contato' }).fill('car');
      await expect(page.getByText('Carlos Lima')).toBeVisible();
      await expect(page.getByText('Ana Souza')).toHaveCount(0);
      await page.getByRole('searchbox', { name: 'Buscar contato' }).fill('5060');
      await expect(page.getByText('Atendimento Starsonic')).toBeVisible();
      await expect(page.getByText('Carlos Lima')).toHaveCount(0);
      await page.getByRole('searchbox', { name: 'Buscar contato' }).fill('');

      await page.getByRole('button', { name: 'Novo contato' }).click();
      await expect(page.getByRole('heading', { name: 'Novo contato' })).toBeVisible();
      await verTextos(page, ['Nome', 'Número', 'Observação (opcional)']);
      await semViolacoesSerias(page);
      await capturar(page, 'contato-novo', tema);
      await page.getByLabel('Nome', { exact: true }).fill('Ana Souza');
      await page.getByLabel('Número').fill('(11) 98888-7777');
      await page.getByLabel('Observação (opcional)').fill('cliente');
      await page.getByRole('button', { name: 'Salvar contato' }).click();
      await esperarComando(page, { cmd: 'saveContact', nome: 'Ana Souza', numero: '(11) 98888-7777', observacao: 'cliente' });
      await expect(page.getByRole('searchbox', { name: 'Buscar contato' })).toBeVisible();

      await page.getByRole('button', { name: 'Mais opções para Carlos Lima' }).click();
      await page.getByRole('menuitem', { name: 'Editar' }).click();
      await expect(page.getByRole('heading', { name: 'Editar contato' })).toBeVisible();
      await expect(page.getByLabel('Número')).toHaveValue('2007');
      await page.getByLabel('Observação (opcional)').fill('');
      await page.getByRole('button', { name: 'Salvar contato' }).click();
      await esperarComando(page, { cmd: 'saveContact', id: 'b7c8d9e0f1a20344', nome: 'Carlos Lima', numero: '2007', observacao: '' });

      await page.getByRole('button', { name: 'Mais opções para Financeiro' }).click();
      await page.getByRole('menuitem', { name: 'Remover' }).click();
      const dialogo = page.getByRole('dialog');
      await expect(dialogo).toContainText('Financeiro');
      await semViolacoesSerias(page);
      await dialogo.getByRole('button', { name: 'Cancelar' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect((await comandos(page)).some((c) => c.cmd === 'removeContact')).toBe(false);
      await page.getByRole('button', { name: 'Mais opções para Financeiro' }).click();
      await page.getByRole('menuitem', { name: 'Remover' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Remover' }).click();
      await esperarComando(page, { cmd: 'removeContact', id: 'd4e5f6a7b8c90122' });
    });

    test('Configurações shows accounts, audio and calls and sends the settings', async ({ page }) => {
      await abrir(page, 'configuracoes');
      await verTextos(page, [
        'Configurações',
        'Contas',
        'Recepção · 2001',
        'starcloud1-starsonic.com.br · UDP · em uso',
        'Caixa 2 · 2015',
        'starcloud-starsonic.com.br · TCP',
        'Adicionar conta',
        'Áudio',
        'Microfone',
        'Alto-falante',
        'Toque',
        'Ligações',
        'Atender automaticamente',
        'Depois de 3 segundos tocando',
        'Iniciar com o Windows',
      ]);
      await expect(page.getByLabel('Alto-falante')).toHaveValue('Fone Bluetooth');
      await expect(page.getByLabel('Alto-falante').locator('option:checked')).toHaveText('Fone Bluetooth (desconectado)');
      await expect(page.getByLabel('Microfone')).toHaveValue('Headset USB');
      await semViolacoesSerias(page);
      await capturar(page, 'configuracoes', tema);

      await page.getByRole('switch', { name: 'Atender automaticamente' }).click();
      await esperarComando(page, { cmd: 'setAutoAnswer', on: true });
      // O switch segue o estado: liga quando o C++ (falso) devolve o estado novo.
      await expect(page.getByRole('switch', { name: 'Atender automaticamente' })).toHaveAttribute('aria-checked', 'true');
      await page.getByLabel('Tempo para atender').selectOption('5');
      await esperarComando(page, { cmd: 'setAutoAnswer', on: true, segundos: 5 });
      await verTextos(page, ['Depois de 5 segundos tocando']);
      const iniciar = page.getByRole('switch', { name: 'Iniciar com o Windows' });
      await expect(iniciar).toHaveAttribute('aria-checked', 'true');
      await iniciar.click();
      await esperarComando(page, { cmd: 'setSetting', chave: 'iniciarComWindows', valor: false });
      await page.getByLabel('Microfone').selectOption({ label: 'Microfone (Realtek)' });
      await esperarComando(page, { cmd: 'setAudio', microfone: 'Microfone (Realtek)' });
      await page.getByLabel('Alto-falante').selectOption('');
      await esperarComando(page, { cmd: 'setAudio', altoFalante: '' });

      // Editar a conta: a tela Entrar preenchida, a senha vazia, o contaId de volta no login.
      await page.getByRole('button', { name: 'Editar a conta Caixa 2' }).click();
      await expect(page.getByRole('heading', { name: 'Editar conta' })).toBeVisible();
      await expect(page.getByLabel('Servidor (endereço ou IP)')).toHaveValue('starcloud-starsonic.com.br');
      await expect(page.getByRole('radio', { name: 'TCP' })).toBeChecked();
      await expect(page.getByLabel('Ramal', { exact: true })).toHaveValue('2015');
      await expect(page.getByLabel('Nome da conta (opcional)')).toHaveValue('Caixa 2');
      await semViolacoesSerias(page);
      await capturar(page, 'conta-editar', tema);
      await page.getByRole('button', { name: 'Remover' }).click();
      const remover = page.getByRole('dialog', { name: 'Remover conta' });
      await expect(remover).toBeVisible();
      await semViolacoesSerias(page);
      await remover.getByRole('button', { name: 'Cancelar' }).click();
      await expect(remover).toHaveCount(0);
      await page.getByRole('button', { name: 'Entrar' }).click();
      await esperarComando(page, {
        cmd: 'login',
        servidor: 'starcloud-starsonic.com.br',
        protocolo: 'tcp',
        ramal: '2015',
        senha: '',
        nome: 'Caixa 2',
        contaId: '41aa07c3d2e95b18',
      });
      // O C++ falso registra: o formulário fecha sozinho e volta às Configurações.
      await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();

      await page.getByRole('button', { name: 'Adicionar conta' }).click();
      await expect(page.getByRole('heading', { name: 'Adicionar conta' })).toBeVisible();
      await expect(page.getByLabel('Servidor (endereço ou IP)')).toHaveValue('');
      await page.getByRole('button', { name: 'Voltar' }).click();
      await page.getByRole('button', { name: 'Voltar' }).click();
      await expect(page.getByRole('textbox', { name: 'Número' })).toBeVisible();
    });

    test('Sobre shows the version, the license and the links', async ({ page }) => {
      await abrir(page, 'sobre');
      await verTextos(page, [
        'Sobre',
        'Starsonic Phone 0.1.0-rc.1',
        'Licença GPL v3 · usa o PJSIP (GPL v2 ou posterior) e o Opus (BSD)',
        'starsonic.com.br',
        '(11) 5060-3000',
        'Também no WhatsApp · seg. a sex., 8h às 18h',
        'Código-fonte',
        'github.com/LucasCPena/starsonic-phone',
        'Enviar diagnóstico',
      ]);
      const logo = page.getByRole('img', { name: 'Starsonic soluções de voz e dados' });
      const esperado = tema === 'dark' ? 'starsonic-logo-negativo.png' : 'starsonic-logo-principal.png';
      await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.currentSrc)).toContain(esperado);
      expect(await logo.evaluate((img: HTMLImageElement) => img.getBoundingClientRect().width)).toBeGreaterThanOrEqual(160);
      await semViolacoesSerias(page);
      await capturar(page, 'sobre', tema);

      await page.getByRole('button', { name: 'Enviar diagnóstico' }).click();
      await esperarComando(page, { cmd: 'sendDiagnostics' });
      await page.getByRole('button', { name: 'Abrir starsonic.com.br' }).click();
      await esperarComando(page, { cmd: 'openExternal', url: 'https://starsonic.com.br' });
      await page.getByRole('button', { name: 'Abrir o WhatsApp' }).click();
      await esperarComando(page, { cmd: 'openExternal', url: 'https://wa.me/551150603000' });
      await page.getByRole('button', { name: 'Abrir o código-fonte' }).click();
      await esperarComando(page, { cmd: 'openExternal', url: 'https://github.com/LucasCPena/starsonic-phone' });
      await page.getByRole('button', { name: 'Voltar' }).click();
      await expect(page.getByRole('textbox', { name: 'Número' })).toBeVisible();
    });
  });
}

test.describe('ponte e janela', () => {
  test('the interface sends ready first and opens Configurações and Sobre from the menu', async ({ page }) => {
    await abrir(page, 'principal');
    expect((await comandos(page))[0]).toEqual({ v: 1, cmd: 'ready' });
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Configurações' }).click();
    await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
    await page.getByRole('button', { name: 'Voltar' }).click();
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Sobre' }).click();
    await expect(page.getByRole('heading', { name: 'Sobre' })).toBeVisible();
  });

  test('without the webview and without ?fake the interface shows an error and sends nothing', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.getByRole('alert')).toHaveText('Não foi possível iniciar a interface. Reinstale o Starsonic Phone.');
    await expect(page.locator('body[data-pronto]')).toHaveCount(0);
    // Nada dos cenários de exemplo: nem conta, nem contatos, nem as telas.
    for (const texto of ['Conectado', 'Recepção', 'Ana Souza', 'Ligar', 'Teclado', 'Entrar']) {
      await expect(page.getByText(texto)).toHaveCount(0);
    }
    expect(await page.evaluate(() => (window as unknown as { __comandos?: unknown }).__comandos)).toBeUndefined();
    // Um cenário que não existe também não cai num cenário qualquer.
    await page.goto('/index.html?fake=nao-existe');
    await expect(page.getByRole('alert')).toHaveText('Não foi possível iniciar a interface. Reinstale o Starsonic Phone.');
    await expect(page.getByText('Conectado')).toHaveCount(0);
  });

  test('the main screen follows a theme change without reloading', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await abrir(page, 'principal');
    const fundo = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(await fundo()).toBe('rgb(255, 255, 255)'); // #ffffff
    await page.getByRole('button', { name: '2', exact: true }).click();
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await fundo()).toBe('rgb(10, 19, 48)'); // #0a1330
    // Sem recarregar: o número digitado continua.
    await expect(page.getByRole('textbox', { name: 'Número' })).toHaveValue('2');
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await fundo()).toBe('rgb(255, 255, 255)');
  });

  test('the bundle loads nothing from the network', async ({ page, baseURL }) => {
    const pedidos: string[] = [];
    page.on('request', (r) => pedidos.push(r.url()));
    for (const cenario of ['entrar', 'principal', 'recentes', 'contatos', 'configuracoes', 'sobre']) {
      await abrir(page, cenario);
      await page.evaluate(() => document.fonts.ready);
    }
    const origem = new URL(baseURL!).origin;
    expect(pedidos.filter((u) => !u.startsWith(origem + '/') && !u.startsWith('data:'))).toEqual([]);
    // A fonte e os logos vêm do próprio app.
    expect(pedidos.some((u) => u.endsWith('/assets/PlusJakartaSans-Variable.woff2'))).toBe(true);
    expect(await page.evaluate(() => document.fonts.check('700 16px "Plus Jakarta Sans"'))).toBe(true);

    // Nenhum endereço de rede nos arquivos que a página lê, além dos links que o openExternal abre no
    // navegador e dos nomes de espaço do SVG (identificadores, não pedidos).
    const permitidos = new Set([
      'https://starsonic.com.br',
      'https://wa.me/551150603000',
      'https://github.com/LucasCPena/starsonic-phone',
      'http://www.w3.org/2000/svg',
      'http://www.w3.org/1999/xlink',
      'http://www.w3.org/1999/xhtml',
      'http://www.w3.org/1998/Math/MathML',
    ]);
    const arquivos: string[] = [];
    const visitar = (pasta: string) => {
      for (const nome of readdirSync(pasta)) {
        const caminho = join(pasta, nome);
        if (statSync(caminho).isDirectory()) visitar(caminho);
        else if (/\.(html|js|css)$/.test(nome)) arquivos.push(caminho);
      }
    };
    visitar(DIST);
    expect(arquivos.map((a) => a.slice(DIST.length)).sort()).toEqual(expect.arrayContaining(['app.css', 'app.js', 'index.html']));
    const encontrados = arquivos.flatMap((a) => readFileSync(a, 'utf8').match(/https?:\/\/[^\s"'`)<>\\]*/g) ?? []);
    expect(encontrados.filter((u) => !permitidos.has(u))).toEqual([]);
    const html = readFileSync(join(DIST, 'index.html'), 'utf8');
    expect(html).not.toMatch(/(src|href)=["']?(https?:)?\/\//);
    // Nenhum tel: (o app é o tratador dele: o link só encheria o Teclado).
    expect(arquivos.filter((a) => readFileSync(a, 'utf8').includes('tel:'))).toEqual([]);
  });

  test('the update question focuses Depois: an Enter meant for the keypad never starts the update', async ({ page }) => {
    await abrir(page, 'principal');
    const campo = page.getByRole('textbox', { name: 'Número' });
    await campo.focus();
    await page.keyboard.type('2003');
    await empurrar(page, { v: 1, type: 'update', versao: '0.1.0-rc.2', notas: '' });
    const dialogo = page.getByRole('dialog', { name: 'Atualização' });
    await expect(dialogo).toBeVisible();
    await expect(dialogo.getByRole('button', { name: 'Depois' })).toBeFocused();
    await page.keyboard.press('Enter');
    await esperarComando(page, { cmd: 'updateLater' });
    expect((await comandos(page)).filter((c) => c.cmd === 'updateNow')).toEqual([]);
    expect((await comandos(page)).filter((c) => c.cmd === 'dial')).toEqual([]);
  });

  test('the pages load the script and the styles of their own build (no cached app.js of another version)', async () => {
    for (const [pagina, script] of [
      ['index.html', 'app.js'],
      ['aviso.html', 'aviso.js'],
    ]) {
      const html = readFileSync(join(DIST, pagina), 'utf8');
      for (const arquivo of [script, 'app.css']) {
        const marca = html.match(new RegExp(`(?:src|href)="${arquivo.replace('.', '\\.')}\\?v=([0-9a-f]{12})"`));
        expect(marca, `${pagina}: ${arquivo} sem ?v=<conteúdo>`).not.toBeNull();
        const { createHash } = await import('node:crypto');
        const esperado = createHash('sha256').update(readFileSync(join(DIST, arquivo))).digest('hex').slice(0, 12);
        expect(marca![1], `${pagina}: ${arquivo}`).toBe(esperado);
      }
    }
  });

  test("the bundle ships Preact's MIT notice", async () => {
    const aviso = join(DIST, 'assets', 'preact-LICENSE.txt');
    expect(existsSync(aviso), aviso).toBe(true);
    const texto = readFileSync(aviso, 'utf8');
    expect(texto).toContain('The MIT License');
    expect(texto).toContain('Jason Miller');
  });

  // (rc.4) O miniz (o .xlsx do importar, do exportar e da lista da empresa) e o nlohmann/json vão dentro do
  // StarsonicPhone.exe: a licença MIT pede o aviso junto das cópias, e o instalador leva a pasta ui\ inteira.
  test('the bundle ships the MIT notices of miniz and nlohmann/json, which go inside the executable', async () => {
    for (const [publicado, fonte, autor] of [
      ['miniz-LICENSE.txt', 'starsonic/third_party/miniz/LICENSE', 'Rich Geldreich'],
      ['nlohmann-json-LICENSE.txt', 'starsonic/third_party/nlohmann/LICENSE.MIT', 'Niels Lohmann'],
    ]) {
      const aviso = join(DIST, 'assets', publicado);
      expect(existsSync(aviso), aviso).toBe(true);
      // A cópia como veio, byte a byte, da licença que está ao lado do código.
      const original = fileURLToPath(new URL(`../../../${fonte}`, import.meta.url));
      expect(readFileSync(aviso).equals(readFileSync(original)), `${publicado} = ${fonte}`).toBe(true);
      const texto = readFileSync(aviso, 'utf8');
      expect(texto, publicado).toContain('Permission is hereby granted, free of charge');
      expect(texto, publicado).toContain(autor);
    }
  });

  test('a toast shows for 2 seconds', async ({ page }) => {
    await abrir(page, 'principal');
    await empurrar(page, { v: 1, type: 'toast', texto: 'A troca de conta fica para o fim da ligação.' });
    const aviso = page.getByRole('status').filter({ hasText: 'A troca de conta fica para o fim da ligação.' });
    await expect(aviso).toBeVisible();
    await empurrar(page, { v: 1, type: 'toast', texto: 'Sem conexão com o servidor. Tente de novo em instantes.' });
    await expect(page.getByText('A troca de conta fica para o fim da ligação.')).toHaveCount(0);
    await expect(page.getByText('Sem conexão com o servidor. Tente de novo em instantes.')).toBeVisible();
    await expect(page.getByText('Sem conexão com o servidor. Tente de novo em instantes.')).toHaveCount(0, { timeout: 3500 });
  });

  test('the update question answers later with Depois or Esc, and a new one takes its place', async ({ page }) => {
    await abrir(page, 'principal');
    await empurrar(page, { v: 1, type: 'update', versao: '0.1.0-rc.2', notas: '' });
    const dialogo = page.getByRole('dialog', { name: 'Atualização' });
    await expect(dialogo).toBeVisible();
    await dialogo.getByRole('button', { name: 'Depois' }).click();
    await esperarComando(page, { cmd: 'updateLater' });
    await expect(dialogo).toHaveCount(0);

    // A pergunta de novo (o ready depois de recarregar): Esc tambem e "Depois".
    await empurrar(page, { v: 1, type: 'update', versao: '0.1.0-rc.2', notas: '' });
    await expect(dialogo).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialogo).toHaveCount(0);
    await expect.poll(async () => (await comandos(page)).filter((c) => c.cmd === 'updateLater').length).toBe(2);

    // Uma versao nova com a pergunta aberta: a nova toma o lugar.
    await empurrar(page, { v: 1, type: 'update', versao: '0.1.0-rc.2', notas: '' });
    await expect(page.getByText('Nova versão do Starsonic Phone disponível (0.1.0-rc.2). Atualizar agora?')).toBeVisible();
    await empurrar(page, { v: 1, type: 'update', versao: '0.1.0-rc.3', notas: '' });
    await expect(page.getByText('Nova versão do Starsonic Phone disponível (0.1.0-rc.3). Atualizar agora?')).toBeVisible();
    await expect(dialogo).toHaveCount(1);
    expect((await comandos(page)).filter((c) => c.cmd === 'updateLater')).toHaveLength(2);
  });

  test('a message of another version asks to reinstall', async ({ page }) => {
    await abrir(page, 'principal');
    await empurrar(page, { v: 2, type: 'toast', texto: 'x' });
    await expect(page.getByText('Reinstale o Starsonic Phone.')).toBeVisible();
    await expect(page.getByText('x', { exact: true })).toHaveCount(0);
  });

  test('a dial link fills the keypad each time tecladoVez changes', async ({ page }) => {
    await abrir(page, 'recentes');
    const estado = await page.evaluate(() => (window as unknown as { __fake: { state(): unknown } }).__fake.state());
    await empurrar(page, { v: 1, type: 'state', state: { ...(estado as object), teclado: '2004', tecladoVez: 1 } });
    await expect(page.getByRole('textbox', { name: 'Número' })).toHaveValue('2004');
    await page.getByRole('button', { name: 'Apagar' }).click();
    await empurrar(page, { v: 1, type: 'state', state: { ...(estado as object), teclado: '2004', tecladoVez: 1, perdidas: 0 } });
    await expect(page.getByRole('textbox', { name: 'Número' })).toHaveValue('200');
    await empurrar(page, { v: 1, type: 'state', state: { ...(estado as object), teclado: '2004', tecladoVez: 2 } });
    await expect(page.getByRole('textbox', { name: 'Número' })).toHaveValue('2004');
    expect((await comandos(page)).some((c) => c.cmd === 'dial')).toBe(false);
  });

  test('the account line shows the registration state', async ({ page }) => {
    await abrir(page, 'principal');
    const estado = (await page.evaluate(() => (window as unknown as { __fake: { state(): unknown } }).__fake.state())) as {
      conta: Record<string, unknown>;
    };
    await empurrar(page, {
      v: 1,
      type: 'state',
      state: { ...estado, conta: { ...estado.conta, status: 'erro', texto: 'Ramal ou senha incorretos.' } },
    });
    await expect(page.getByText('Ramal ou senha incorretos.')).toBeVisible();
    await empurrar(page, { v: 1, type: 'state', state: { ...estado, conta: { ...estado.conta, nome: '', status: 'sem_conexao', texto: '' } } });
    await expect(page.getByText('2001', { exact: true })).toBeVisible();
    await expect(page.getByText('Sem conexão', { exact: true })).toBeVisible();
  });

  test('focus is visible with a 3 px ring', async ({ page }) => {
    await abrir(page, 'principal');
    // Tab até uma tecla do Teclado (antes vêm a barra de título e o cabeçalho).
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(() => document.activeElement?.classList.contains('key'))) break;
    }
    const anel = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const s = getComputedStyle(el);
      return { largura: s.outlineWidth, estilo: s.outlineStyle, afastamento: s.outlineOffset };
    });
    expect(anel).toEqual({ largura: '3px', estilo: 'solid', afastamento: '2px' });
  });

  test('animations are off with prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await abrir(page, 'principal');
    const duracao = await page.getByRole('button', { name: 'Ligar', exact: true }).evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(parseFloat(duracao)).toBeLessThan(0.001);
  });
});

// O foco do formulário do contato (C-M2, o mesmo padrão da edição do atalho): o `autofocus` só vale uma vez por
// documento (a segunda abertura ficava no <body>) e a edição de um contato não tinha foco nenhum.
test.describe('o foco do formulário do contato', () => {
  const nome = (page: Page) => page.getByLabel('Nome', { exact: true });

  test('Nome takes the focus every time the form opens, for a new contact and for an existing one', async ({ page }) => {
    await abrir(page, 'contatos');
    for (const vez of [1, 2]) {
      await page.getByRole('button', { name: 'Novo contato' }).click();
      await expect(page.getByRole('heading', { name: 'Novo contato' })).toBeVisible();
      await expect(nome(page), `abertura ${vez} de um contato novo`).toBeFocused();
      await page.getByRole('button', { name: 'Voltar' }).click();
      await expect(page.getByRole('searchbox', { name: 'Buscar contato' })).toBeVisible();
    }
    await page.getByRole('button', { name: 'Mais opções para Carlos Lima' }).click();
    await page.getByRole('menuitem', { name: 'Editar' }).click();
    await expect(page.getByRole('heading', { name: 'Editar contato' })).toBeVisible();
    await expect(nome(page)).toHaveValue('Carlos Lima');
    await expect(nome(page), 'editar um contato').toBeFocused();
  });

  test('Salvar contato from Recentes focuses Nome every time too', async ({ page }) => {
    await abrir(page, 'recentes');
    for (const vez of [1, 2]) {
      await page.getByRole('button', { name: /^3001/ }).click();
      await page.getByRole('button', { name: 'Salvar contato' }).click();
      await expect(page.getByRole('heading', { name: 'Novo contato' })).toBeVisible();
      await expect(nome(page), `abertura ${vez}`).toBeFocused();
      await page.getByRole('button', { name: 'Voltar' }).click();
      await expect(page.getByRole('button', { name: 'Todas' })).toBeVisible();
    }
  });
});

// rc.4: a lista da empresa nos Contatos (a etiqueta, os filtros e o "⋯") e a parte "Contatos" das Configurações (a
// planilha, a ajuda e a situação), nos dois temas e nas três larguras (Normal, Compacto e Mínimo): nada rola na
// horizontal, a etiqueta e o Salvar cabem, o axe e uma captura por tela, tema e largura.
const LARGURAS: Array<[number, number]> = [
  [400, 720],
  [340, 560],
  [300, 440],
];
const AJUDA_DA_PLANILHA =
  'Cole o link do Google Planilhas ou do OneDrive/SharePoint, compartilhado para qualquer pessoa com o link, ou o caminho do arquivo na rede.';
const LINK_FECHADO = 'Não consegui abrir o link. Confira se a planilha está compartilhada para qualquer pessoa com o link.';

async function semRolarNaHorizontal(page: Page, largura: number): Promise<void> {
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth), 'a página rola na horizontal').toBeLessThanOrEqual(largura);
  const rolam = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.win *'))
      .filter((e) => e.scrollWidth > e.clientWidth + 1 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowX))
      .map((e) => e.className),
  );
  expect(rolam, 'algo rola na horizontal').toEqual([]);
}

/** O fim do corpo das Configurações (a parte "Contatos" é a última). */
async function irAoFim(page: Page): Promise<void> {
  await page.locator('.body.scroll').evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
}

for (const tema of ['light', 'dark'] as const) {
  for (const [largura, altura] of LARGURAS) {
    test.describe(`a lista da empresa em ${largura}×${altura} (${tema})`, () => {
      test.use({ viewport: { width: largura, height: altura }, colorScheme: tema });

      test('Contatos shows the company contacts with the tag, the filters and the more menu', async ({ page }) => {
        await abrir(page, 'contatos-empresa');
        await verTextos(page, ['Todos', 'Meus', 'Empresa', 'Almoxarifado', 'Ramal 3010 · Galpão 1', 'Ana Souza', 'Ramal 2003 · Comercial']);
        await expect(page.getByRole('button', { name: 'Todos', exact: true })).toHaveAttribute('aria-pressed', 'true');
        // A Ana Souza da planilha também é minha: uma vez só, a minha.
        await expect(page.locator('li.row .row-title').getByText('Ana Souza', { exact: true })).toHaveCount(1);
        await semRolarNaHorizontal(page, largura);
        // O nome comprido encolhe (com reticências) e a etiqueta fica inteira, antes do botão de ligar.
        const longa = page.locator('li.row').filter({ hasText: 'Coordenação de Logística e Transportes' });
        await longa.scrollIntoViewIfNeeded();
        const tag = longa.getByText('Empresa', { exact: true });
        const t = (await tag.boundingBox())!;
        const ligar = (await longa.getByRole('button', { name: 'Ligar para Coordenação de Logística e Transportes' }).boundingBox())!;
        expect(t.x + t.width, 'a etiqueta passa por cima do ligar').toBeLessThanOrEqual(ligar.x + 0.5);
        expect(await tag.evaluate((e) => e.scrollWidth <= e.clientWidth + 0.5), 'a etiqueta cortada').toBe(true);
        await page.locator('.body.scroll').evaluate((e) => {
          e.scrollTop = 0;
        });
        await semViolacoesSerias(page);
        await capturar(page, `contatos-empresa-${largura}x${altura}`, tema);

        // O "⋯" com o menu aberto, inteiro dentro da janela.
        await page.getByRole('button', { name: 'Mais opções', exact: true }).click();
        const menu = page.getByRole('menu', { name: 'Mais opções' });
        await expect(menu.getByRole('menuitem', { name: 'Importar planilha…' })).toBeFocused();
        const m = (await menu.boundingBox())!;
        expect(m.x >= -0.5 && m.y >= -0.5 && m.x + m.width <= largura + 0.5 && m.y + m.height <= altura + 0.5, `o menu sai da janela: ${JSON.stringify(m)}`).toBe(
          true,
        );
        await semViolacoesSerias(page);
        await capturar(page, `contatos-mais-opcoes-${largura}x${altura}`, tema);
      });

      test('Configurações shows the company sheet with its status', async ({ page }) => {
        await abrir(page, 'contatos-empresa');
        await page.getByRole('button', { name: 'Menu' }).click();
        await page.getByRole('menuitem', { name: 'Configurações' }).click();
        const campo = page.getByLabel('Planilha da empresa', { exact: true });
        await expect(campo).toHaveValue('\\\\servidor\\contatos\\empresa.xlsx');
        await irAoFim(page);
        await verTextos(page, ['Contatos', 'Planilha da empresa', 'Salvar', AJUDA_DA_PLANILHA, 'Atualizada às 14:32 · 7 contatos', 'Atualizar agora']);
        await semRolarNaHorizontal(page, largura);
        // O campo e o Salvar na mesma linha, os dois inteiros dentro do cartão.
        const c = (await campo.boundingBox())!;
        const s = (await page.getByRole('button', { name: 'Salvar', exact: true }).boundingBox())!;
        const cartao = (await page.locator('.card').filter({ has: campo }).boundingBox())!;
        expect(s.x, 'o Salvar em cima do campo').toBeGreaterThanOrEqual(c.x + c.width - 0.5);
        expect(Math.abs(s.y + s.height / 2 - (c.y + c.height / 2)), 'o Salvar fora da linha do campo').toBeLessThanOrEqual(1);
        expect(s.x + s.width, 'o Salvar sai do cartão').toBeLessThanOrEqual(cartao.x + cartao.width + 0.5);
        expect(c.width, 'o campo estreito demais').toBeGreaterThanOrEqual(120);
        await semViolacoesSerias(page);
        await capturar(page, `configuracoes-empresa-${largura}x${altura}`, tema);

        // O erro com a lista de antes: os textos mais compridos quebram a linha dentro do cartão.
        await mudarEstado(page, (st) => ({ ...st, empresa: { ...st.empresa, situacao: 'erro', erro: LINK_FECHADO } }));
        await verTextos(page, [LINK_FECHADO, 'Última lista: às 14:32 · 7 contatos']);
        await irAoFim(page);
        await semRolarNaHorizontal(page, largura);
        await semViolacoesSerias(page);
        await capturar(page, `configuracoes-empresa-erro-${largura}x${altura}`, tema);
      });
    });
  }
}
