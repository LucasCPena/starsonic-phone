// O aviso do Windows e o número (Task 6, o quadro Aviso): a mensagem que chega pede o chatNotify com o nome e o começo
// dela (no grupo, "<nome> no <grupo>"; uma foto é "Foto", e um arquivo, "Arquivo: <nome>"), cortado nos 120 primeiros
// caracteres com "…"; nada para as minhas (também do meu outro computador), para os avisos de grupo e para a conversa
// aberta com a janela na frente; o `abrir` do núcleo leva à conversa do aviso (0: a aba Chat); e o número, com o "9+"
// da aba. Os avisos só vêm pelos eventos: cada teste espera o WebSocket aberto antes da mensagem.
import { expect, test, type APIResponse, type Page, type Route } from '@playwright/test';
import { comandos, depoisDoQueChegou, empurrar, esperarComando } from '../helpers';
import { abrirAConversa, abrirNoChat, esperarOsEventos } from './abrir';
import { ApiDeTeste, baseDoChat, empresaComPessoas, ligarComputador } from './servidor';

test.use({ bypassCSP: true });

const EMPRESA = 'ACME Comércio Ltda';
const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
const ANA = { ramal: '2003', nome: 'Ana Souza' };
const JOAO = { ramal: '2004', nome: 'João Pereira' };

const abaChat = (page: Page) => page.getByRole('navigation', { name: 'Seções' }).locator('.tab-chat');
/** Os avisos do Windows de uma conversa (a 0 é a do computador novo). */
const avisosDe = async (page: Page, conversa: number) => (await comandos(page)).filter((c) => c.cmd === 'chatNotify' && c.conversa === conversa);
/** Um PNG de 1×1 (o servidor trata image/png como foto). */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('a message in a closed conversation asks the Windows notice with the name and the start', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await esperarOsEventos(page);
  await page.keyboard.press('Control+1');
  await expect(page.getByRole('main', { name: 'Teclado' })).toBeVisible();

  await ana.api.enviarTexto(dupla, 'Pode me mandar a proposta da ACME?');
  await esperarComando(page, { cmd: 'chatNotify', conversa: dupla, titulo: 'Ana Souza', texto: 'Pode me mandar a proposta da ACME?' });
  expect(await avisosDe(page, dupla)).toHaveLength(1);
});

test('in a group the title is Nome no Grupo, a photo is Foto and a file is Arquivo: <nome>', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, JOAO]);
  const [a, joao] = pessoas;
  const comercial = await joao.api.criarGrupo('Comercial', [a.pessoa.id]);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await esperarOsEventos(page);
  const titulo = 'João Pereira no Comercial';

  await joao.api.enviarTexto(comercial, 'Fechamos o pedido de hoje.');
  await esperarComando(page, { cmd: 'chatNotify', conversa: comercial, titulo, texto: 'Fechamos o pedido de hoje.' });
  await joao.api.enviarArquivo(comercial, PNG, 'nota-fiscal.png', 'image/png');
  await esperarComando(page, { cmd: 'chatNotify', conversa: comercial, titulo, texto: 'Foto' });
  await joao.api.enviarArquivo(
    comercial,
    Buffer.from('planilha de teste'),
    'Pedido 4471.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  await esperarComando(page, { cmd: 'chatNotify', conversa: comercial, titulo, texto: 'Arquivo: Pedido 4471.xlsx' });
  // Os avisos de grupo (o criou e o pos de quando o grupo nasceu) não pediram nada.
  expect((await avisosDe(page, comercial)).map((c) => c.texto)).toEqual(['Fechamos o pedido de hoje.', 'Foto', 'Arquivo: Pedido 4471.xlsx']);
});

test('a long message is cut at 120 characters with …', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await esperarOsEventos(page);

  // Pontos de código: um emoji conta 1, um acento também.
  await ana.api.enviarTexto(dupla, '😀'.repeat(60) + 'á'.repeat(100));
  await esperarComando(page, { cmd: 'chatNotify', conversa: dupla, titulo: 'Ana Souza', texto: '😀'.repeat(60) + 'á'.repeat(60) + '…' });
  // Com 120, inteira e sem "…".
  await ana.api.enviarTexto(dupla, 'b'.repeat(120));
  await esperarComando(page, { cmd: 'chatNotify', conversa: dupla, titulo: 'Ana Souza', texto: 'b'.repeat(120) });
});

test('my own message from another computer and the group notices ask no notice', async ({ page }) => {
  const { codigo, pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO]);
  const [a, ana, joao] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await esperarOsEventos(page);

  // A mesma pessoa manda do outro computador dela.
  const outro = await ligarComputador(codigo, 'RECEPCAO-02');
  const meuOutro = new ApiDeTeste(outro.chave);
  await meuOutro.entrar(RECEPCAO.ramal, RECEPCAO.nome);
  await meuOutro.enviarTexto(dupla, 'Mandei do outro computador.');
  // Os avisos de grupo: o grupo novo comigo (o criou e o pos) e a Ana posta depois.
  const comercial = await joao.api.criarGrupo('Comercial', [a.pessoa.id]);
  const posta = await joao.api.pedir('POST', `/api/v1/conversas/${comercial}/membros`, { pessoas: [ana.pessoa.id] });
  expect(posta.status).toBe(204);
  // Os eventos vêm na ordem: quando o aviso desta chega, os de antes já foram tratados.
  await ana.api.enviarTexto(dupla, 'Bom dia!');
  await esperarComando(page, { cmd: 'chatNotify', conversa: dupla, titulo: 'Ana Souza', texto: 'Bom dia!' });
  expect(await avisosDe(page, dupla)).toEqual([{ v: 1, cmd: 'chatNotify', conversa: dupla, titulo: 'Ana Souza', texto: 'Bom dia!' }]);
  expect(await avisosDe(page, comercial)).toEqual([]);
  // A minha do outro computador está na lista, e não conta como não lida.
  await expect(abaChat(page)).toHaveAccessibleName('Chat, 1 mensagem não lida');
});

test('the open conversation with the window in front asks no notice, and with the window out of front it does', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO]);
  const [a, ana, joao] = pessoas;
  const comAna = await ana.api.criarDupla(a.pessoa.id);
  await ana.api.enviarTexto(comAna, 'Bom dia!');
  const comJoao = await joao.api.criarDupla(a.pessoa.id);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  const log = page.getByRole('log', { name: 'Mensagens com Ana Souza' });
  await esperarOsEventos(page);

  // Aberta e na frente: a mensagem aparece, sem aviso. A do João (outra conversa) pede o dela, depois.
  await ana.api.enviarTexto(comAna, 'Viu o pedido da ACME?');
  await expect(log.locator('.balao-texto').last()).toHaveText('Viu o pedido da ACME?');
  await joao.api.enviarTexto(comJoao, 'Tudo certo por aí?');
  await esperarComando(page, { cmd: 'chatNotify', conversa: comJoao, titulo: 'João Pereira', texto: 'Tudo certo por aí?' });
  expect(await avisosDe(page, comAna)).toEqual([]);

  // Fora da frente (minimizada, atrás de outra janela, a sessão bloqueada): a mesma conversa aberta pede o aviso.
  await empurrar(page, { v: 1, type: 'janela', frente: false });
  await depoisDoQueChegou(page);
  await ana.api.enviarTexto(comAna, 'Pode me mandar a proposta da ACME?');
  await esperarComando(page, { cmd: 'chatNotify', conversa: comAna, titulo: 'Ana Souza', texto: 'Pode me mandar a proposta da ACME?' });
  expect(await avisosDe(page, comAna)).toHaveLength(1);
});

test('abrir from the core opens that conversation, and conversa 0 opens the Chat tab', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await ana.api.enviarTexto(dupla, 'Pode me mandar a proposta da ACME?');
  // A primeira lista das conversas fica presa: o `abrir` chega antes dela (o app aberto pelo clique no aviso).
  let presa: { rota: Route; resposta: APIResponse } | null = null;
  await page.route(`${baseDoChat()}/api/v1/conversas`, async (rota) => {
    if (presa !== null || rota.request().method() !== 'GET') return rota.continue();
    presa = { rota, resposta: await rota.fetch() };
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await expect.poll(() => presa !== null).toBe(true);
  await empurrar(page, { v: 1, type: 'abrir', tela: 'chat', conversa: dupla });
  await depoisDoQueChegou(page);
  const conversa = page.getByRole('log', { name: 'Mensagens com Ana Souza' });
  await expect(conversa).toHaveCount(0);
  await presa!.rota.fulfill({ response: presa!.resposta });
  await expect(conversa.locator('.balao-texto')).toHaveText(['Pode me mandar a proposta da ACME?']);

  // De outra tela, na hora.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+1');
  await expect(page.getByRole('main', { name: 'Teclado' })).toBeVisible();
  await empurrar(page, { v: 1, type: 'abrir', tela: 'chat', conversa: dupla });
  await expect(conversa).toBeVisible();
  // A conversa 0: a aba Chat.
  await empurrar(page, { v: 1, type: 'abrir', tela: 'chat', conversa: 0 });
  await expect(page.getByRole('main', { name: 'Chat' })).toBeVisible();
  await expect(conversa).toHaveCount(0);
  await expect(page.locator('.chat-linha')).toHaveCount(1);
  // Uma conversa que não existe (ou que saiu): também a aba Chat.
  await page.keyboard.press('Control+1');
  await empurrar(page, { v: 1, type: 'abrir', tela: 'chat', conversa: dupla + 1000 });
  await expect(page.getByRole('main', { name: 'Chat' })).toBeVisible();
  await expect(page.locator('.chat-linha')).toHaveCount(1);
});

test('twelve unread send chatBadge 12 and the tab shows 9+', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await esperarOsEventos(page);
  await page.keyboard.press('Control+1');
  const numero = abaChat(page).locator('.tab-numero');

  for (let i = 1; i <= 9; i++) await ana.api.enviarTexto(dupla, `Mensagem ${i}`);
  await esperarComando(page, { cmd: 'chatBadge', n: 9 });
  await expect(numero).toHaveText('9');
  for (let i = 10; i <= 12; i++) await ana.api.enviarTexto(dupla, `Mensagem ${i}`);
  await esperarComando(page, { cmd: 'chatBadge', n: 12 });
  await expect(numero).toHaveText('9+');
  await expect(abaChat(page)).toHaveAccessibleName('Chat, 12 mensagens não lidas');
});
