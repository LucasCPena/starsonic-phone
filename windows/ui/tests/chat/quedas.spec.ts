// As quedas (a spec do chat, seção 3, critério 5; R44): a queda da central não derruba o chat, e a queda do chat não
// derruba as ligações. Contra o servidor do chat de teste. A central fora é o estado que o núcleo manda depois de um
// registro sem resposta (o 408, o 503 ou o 0: a conta sem conexão, com a bolinha cinza), com o contaConectada ainda true
// (o par do ramal fica: test_desktop_app.cpp, "the central that falls after the first registration leaves the account in
// the chat"). O chat fora é o servidor que não responde (a faixa do chat). Testes de verificação (o código já existe).
import { expect, test } from '@playwright/test';
import { esperarComando, mudarEstado } from '../helpers';
import { abrirAConversa, abrirNoChat, esperarOsEventos } from './abrir';
import { baseDoChat, empresaComPessoas } from './servidor';

// O CSP da página só deixa falar com o endereço do chat de verdade; o servidor de teste fica no 127.0.0.1:4180.
test.use({ bypassCSP: true });

const EMPRESA = 'ACME Comércio Ltda';
const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
const ANA = { ramal: '2003', nome: 'Ana Souza' };
/** O texto do núcleo para um registro sem resposta (RegistrationErrors.cpp). */
const SEM_A_CENTRAL = 'Não foi possível falar com o servidor. Confira o endereço e a sua internet.';
const FAIXA_DO_CHAT = 'Sem conexão com o chat. Tentando de novo…';

test('with the central down (the gray dot) the chat goes on: a conversation opens, a text goes out and one arrives', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await ana.api.enviarTexto(dupla, 'Bom dia. Você viu o pedido da ACME?');
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await expect(page.locator('.chat-linha')).toHaveCount(1);
  await esperarOsEventos(page);

  // A central cai: a conta fica sem conexão, e o chat continua com a conta conectada aqui.
  await mudarEstado(page, (s) => ({
    ...s,
    conta: { ...s.conta, status: 'sem_conexao', texto: SEM_A_CENTRAL },
    chat: { ...s.chat, contaConectada: true },
  }));
  await expect(page.locator('.account-wrap .account-sub')).toHaveText(SEM_A_CENTRAL);
  await expect(page.locator('.account-wrap .dot')).toHaveClass(/dot-off/);
  await expect(page.getByRole('status').filter({ hasText: FAIXA_DO_CHAT })).toHaveCount(0);

  await abrirAConversa(page, 'Ana Souza');
  const log = page.getByRole('log', { name: 'Mensagens com Ana Souza' });
  await expect(log.locator('.balao-texto')).toHaveText(['Bom dia. Você viu o pedido da ACME?']);
  const campo = page.getByRole('textbox', { name: 'Mensagem para Ana Souza' });
  await campo.fill('Vi, sim. Te mando a proposta agora.');
  await campo.press('Enter');
  // A mensagem chega ao servidor, e o balão ganha a hora no lugar do "Enviando…".
  await expect
    .poll(async () => (await ana.api.mensagens(dupla)).map((m) => m.texto))
    .toEqual(['Bom dia. Você viu o pedido da ACME?', 'Vi, sim. Te mando a proposta agora.']);
  await expect(log.locator('.balao-meu .balao-hora')).toHaveText([/^\d\d:\d\d$/]);
  // E a que chega aparece.
  await ana.api.enviarTexto(dupla, 'Obrigada! Fico no aguardo.');
  await expect(log.locator('.balao-outro .balao-texto')).toHaveText(['Bom dia. Você viu o pedido da ACME?', 'Obrigada! Fico no aguardo.']);
});

test('with the chat server down (its banner) a call from the Teclado reaches the core and the call screen shows', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  // O servidor do chat não responde: nenhum pedido dele passa.
  await page.route(`${baseDoChat()}/api/**`, (rota) => rota.abort());
  await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await expect(page.getByRole('status').filter({ hasText: FAIXA_DO_CHAT })).toBeVisible();
  // A central segue: a conta conectada, com a bolinha verde.
  await expect(page.locator('.account-wrap .dot')).toHaveClass(/dot-online/);

  await page.keyboard.press('Control+1');
  await expect(page.getByRole('main', { name: 'Teclado' })).toBeVisible();
  for (const tecla of ['4', '3', '2', '1']) await page.getByRole('button', { name: tecla, exact: true }).click();
  await page.getByRole('button', { name: 'Ligar', exact: true }).click();
  await esperarComando(page, { cmd: 'dial', numero: '4321' });
  // O núcleo faz a ligação: o estado com ela chamando, e a tela da ligação.
  await mudarEstado(page, (s) => ({
    ...s,
    ligacao: {
      top: { id: 41, number: '4321', name: '', incoming: false, phase: 'dialing', activeSinceMs: 0, held: false },
      second: null,
      secondKind: 'none',
      muted: false,
      conference: false,
      conferenceSinceMs: 0,
      consulting: false,
      colleagueActive: false,
    },
  }));
  await expect(page.getByText('Chamando…', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Desligar', exact: true })).toBeVisible();
});
