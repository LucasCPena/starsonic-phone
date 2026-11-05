// O cartão Chat da área do administrador (Task 4): ligar este computador ao chat com o código da empresa, os erros do
// código e desligar, aqui e no servidor. Os erros vêm do page.route: um código errado de verdade conta no limite do
// servidor (10 por hora do endereço), e os testes nunca mandam um.
import { expect, test, type Page } from '@playwright/test';
import { capturar, comandos, entrarNaAdmin, esperarComando, semViolacoesSerias, verTextos } from '../helpers';
import { abrirNoChat } from './abrir';
import { baseDoChat, empresaComPessoas, novaEmpresa } from './servidor';

// O CSP da página só deixa falar com o endereço do chat de verdade; o servidor de teste fica no 127.0.0.1:4180.
test.use({ bypassCSP: true });

const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
const LIGADO = 'Ligado ao chat da ACME Comércio Ltda. A aba Chat já aparece no app.';
const nomeDoTema = (tema: 'light' | 'dark') => (tema === 'light' ? 'claro' : 'escuro');
const campo = (page: Page) => page.getByLabel('Código da empresa', { exact: true });
const ligar = (page: Page) => page.getByRole('button', { name: 'Ligar ao chat', exact: true });

/** O computador fora do chat, na área do administrador. */
async function abrirDesligado(page: Page): Promise<void> {
  await abrirNoChat(page, { chave: '', ...RECEPCAO, cenario: 'chat-desligado' });
  await entrarNaAdmin(page);
}

/** O POST /api/v1/computadores responde o status e o corpo dados, sem chegar ao servidor; segura até o `soltar`. */
async function responderAoLigar(page: Page, status: number, corpo: unknown): Promise<{ soltar(): void }> {
  let soltar = () => {};
  const solta = new Promise<void>((r) => (soltar = r));
  await page.route(`${baseDoChat()}/api/v1/computadores`, async (rota) => {
    await solta;
    await rota.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(corpo) });
  });
  return { soltar };
}

for (const tema of ['light', 'dark'] as const) {
  test.describe(`o cartão Chat (${tema})`, () => {
    test.use({ colorScheme: tema });

    test('Ligar ao chat links this computer with the company code and shows the company', async ({ page }) => {
      const { codigo } = await novaEmpresa('ACME Comércio Ltda');
      await abrirDesligado(page);
      // O cartão Chat vem antes dos botões da tela principal.
      const secoes = page.locator('.adm > h2.eyebrow');
      await expect(secoes.first()).toHaveText('Chat');
      await expect(secoes.nth(1)).toHaveText('Botões da tela principal');
      await verTextos(page, [
        'Chat',
        'Liga este computador ao chat de uma empresa. O código vem da página de administração do chat.',
        'Código da empresa',
        'Ligar ao chat',
      ]);
      await expect(page.getByRole('button', { name: 'Desligar do chat' })).toHaveCount(0);
      await semViolacoesSerias(page);
      await capturar(page, 'adm-chat-desligado', nomeDoTema(tema));

      // O código em minúsculas e com espaços (o servidor põe em maiúsculas e tira os espaços e os hífens).
      await campo(page).fill(codigo.toLowerCase().replaceAll('-', ' '));
      await ligar(page).click();
      await expect.poll(async () => (await comandos(page)).filter((c) => c.cmd === 'chatLink').length).toBe(1);
      const link = (await comandos(page)).find((c) => c.cmd === 'chatLink')!;
      expect(link.chave).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(link.empresa).toBe('ACME Comércio Ltda');
      await verTextos(page, [LIGADO, 'Desligar do chat']);
      await expect(campo(page)).toHaveCount(0);
      // A chave fica só na memória da interface: nem no DOM nem no localStorage.
      expect(await page.content()).not.toContain(String(link.chave));
      expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(String(link.chave));
      await semViolacoesSerias(page);
      await capturar(page, 'adm-chat-ligado', nomeDoTema(tema));

      // Fora da área do administrador, a aba Chat aparece.
      await page.getByRole('button', { name: 'Voltar' }).click();
      await expect(page.getByRole('navigation', { name: 'Seções' }).locator('.tab-chat')).toBeVisible();
    });

    test('a wrong code shows Código não encontrado', async ({ page }) => {
      const resposta = await responderAoLigar(page, 404, { erro: 'codigo' });
      await abrirDesligado(page);
      await expect(ligar(page)).toBeDisabled();
      await campo(page).fill('STAR-AAAA-BBBB');
      await ligar(page).click();
      // Esperando a resposta, o botão fica desligado.
      await expect(ligar(page)).toBeDisabled();
      resposta.soltar();
      const erro = page.getByRole('alert');
      await expect(erro).toHaveText('Código não encontrado. Confira o código na página de administração.');
      await expect(campo(page)).toHaveAttribute('aria-invalid', 'true');
      await expect(ligar(page)).toBeEnabled();
      expect((await comandos(page)).filter((c) => c.cmd === 'chatLink')).toEqual([]);
      await semViolacoesSerias(page);
      await capturar(page, 'adm-chat-codigo', nomeDoTema(tema));
      // Mudar o código tira o erro.
      await campo(page).fill('STAR-AAAA-BBBC');
      await expect(erro).toHaveCount(0);
      await expect(campo(page)).not.toHaveAttribute('aria-invalid', 'true');
    });
  });
}

test('too many tries shows the wait in minutes', async ({ page }) => {
  const resposta = await responderAoLigar(page, 429, { erro: 'tentativas', esperarSegundos: 3540 });
  resposta.soltar();
  await abrirDesligado(page);
  await campo(page).fill('STAR-AAAA-BBBB');
  await ligar(page).click();
  await expect(page.getByRole('alert')).toHaveText('Muitas tentativas. Tente de novo daqui a 59 minutos.');
  await expect(campo(page)).not.toHaveAttribute('aria-invalid', 'true');
  expect((await comandos(page)).filter((c) => c.cmd === 'chatLink')).toEqual([]);
});

test('no connection shows Sem conexão com o chat. Tente de novo.', async ({ page }) => {
  await page.route(`${baseDoChat()}/api/v1/computadores`, (rota) => rota.abort());
  await abrirDesligado(page);
  await campo(page).fill('STAR-AAAA-BBBB');
  await ligar(page).click();
  await expect(page.getByRole('alert')).toHaveText('Sem conexão com o chat. Tente de novo.');
  expect((await comandos(page)).filter((c) => c.cmd === 'chatLink')).toEqual([]);
});

test('a computer taken out of the chat shows the code field again, with Desligar do chat', async ({ page }) => {
  const { pessoas } = await empresaComPessoas('ACME Comércio Ltda', [RECEPCAO]);
  const [a] = pessoas;
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await expect(page.getByText('Nenhuma conversa ainda', { exact: true })).toBeVisible();
  // O servidor não aceita mais a chave deste computador (o DELETE com a mesma chave).
  await a.api.desligar();
  await expect(page.getByText('Este computador saiu do chat. Fale com o suporte da Starsonic.', { exact: true })).toBeVisible();
  await entrarNaAdmin(page);
  await expect(campo(page)).toBeVisible();
  await expect(ligar(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Desligar do chat' })).toBeVisible();
  await expect(page.getByText(LIGADO)).toHaveCount(0);
});

test('Desligar do chat unlinks here and on the server', async ({ page }) => {
  const { pessoas } = await empresaComPessoas('ACME Comércio Ltda', [RECEPCAO]);
  const [a] = pessoas;
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await expect(page.getByText('Nenhuma conversa ainda', { exact: true })).toBeVisible();
  await entrarNaAdmin(page);
  await verTextos(page, [LIGADO]);
  await expect(campo(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Desligar do chat' }).click();
  await esperarComando(page, { cmd: 'chatUnlink' });
  // A chave antiga já não vale no servidor.
  expect((await a.api.pedir('GET', '/api/v1/conversas')).status).toBe(401);
  // O cartão volta a mostrar o campo do código.
  await expect(campo(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Desligar do chat' })).toHaveCount(0);
  await expect(page.getByText(LIGADO)).toHaveCount(0);
  await page.getByRole('button', { name: 'Voltar' }).click();
  await expect(page.getByRole('navigation', { name: 'Seções' }).locator('.tab-chat')).toHaveCount(0);
});
