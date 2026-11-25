// O painel do chat da reunião (painel.js), no Chromium, na reunião de mentira (reuniao-falsa.ts): ao lado dos quadros no
// PC, cobrindo a tela no celular; a lista, o campo, o teclado e a rolagem. Quem entra é a Maria Lima, e o palco é o
// TRES (a Ana, o Carlos, a Maria e Você). O relógio da página está parado às 10:00. As mensagens dos outros chegam pelo
// canal falso, como o servidor as repassa, e as da página ficam guardadas nele.
import { expect, test, type Page } from '@playwright/test';
import {
  ANA,
  BIA,
  CARLOS,
  EU,
  SEM_CONEXAO,
  TRES,
  area,
  botao,
  caixa,
  camDe,
  cartaoDaQueda,
  conferir,
  darNaLigacao,
  dentro,
  doConsole,
  naReuniaoCom,
  quadro,
  subir,
  titulo,
  todosOsQuadros,
  vigiar,
  voltar,
  type NaReuniao,
  type Pessoa,
} from '../reuniao-falsa';
import { type Canal, type Mensagem } from '../rede-falsa';

test.beforeEach(async ({ page }) => {
  await vigiar(page);
});

// Nada do chat vai ao console, nem o texto, nem o nome, nem o id: nos testes daqui, ele fica vazio.
test.afterEach(async ({ page }) => {
  await conferir(page);
  expect(doConsole(page)).toEqual([]);
});

// ---- O painel e as peças dele. ----

const painel = (page: Page) => page.getByRole('complementary', { name: 'Chat da reunião' });
const oChat = (page: Page) => page.locator('button[data-botao="chat"]');
const tituloDoPainel = (page: Page) => painel(page).getByRole('heading', { level: 2, name: 'Chat da reunião' });
const campo = (page: Page) => page.getByLabel('Mensagem para todos da reunião', { exact: true });
const mandar = (page: Page) => botao(page, 'Enviar a mensagem');
const lista = (page: Page) => page.locator('.painel-lista');
const mensagens = (page: Page) => page.locator('.painel-mensagens > .mensagem');
const mensagem = (page: Page, n: number) => page.locator(`.mensagem[data-mensagem="${n}"]`);
const balao = (page: Page, n: number) => mensagem(page, n).locator('.mensagem-texto');
const tentarDeNovo = (page: Page, n: number) => mensagem(page, n).getByRole('button', { name: 'Tentar de novo' });
const nenhuma = (page: Page) => page.getByText('Nenhuma mensagem ainda.', { exact: true });
// A linha do painel, e não a região dos leitores de tela, que diz o mesmo texto quando o canal cai.
const semCanal = (page: Page) => page.locator('.painel-sem-canal');
const controles = (page: Page) => page.getByRole('navigation', { name: 'Controles da reunião' });
/** O que fica atrás do painel que cobre a tela. */
const FUNDO = ['.reuniao-topo', '.palco', '.controles'];
// O número do botão Chat, o aviso curto e a região que os leitores de tela anunciam.
const numero = (page: Page) => oChat(page).locator('.contagem');
const aviso = (page: Page) => page.locator('.aviso-curto');
const quemEscreveu = (page: Page) => aviso(page).locator('.aviso-curto-quem');
const linhaDoAviso = (page: Page) => aviso(page).locator('.aviso-curto-linha');
const abrirOChat = (page: Page) => aviso(page).getByRole('button', { name: 'Abrir o chat', exact: true });
/** O aviso mais novo da região que os leitores de tela anunciam. */
const anuncio = (page: Page) => page.locator('[data-campo="anuncio"] > :last-child');
/** A região inteira, a que os leitores de tela anunciam. */
const regiaoFalada = (page: Page) => page.locator('[data-campo="anuncio"]');

/** O texto do elemento, letra por letra, com as quebras de linha. */
const letras = (page: Page, n: number) => balao(page, n).evaluate((e) => e.textContent);

/** As mensagens do chat que a página mandou pelo canal. */
const mandadas = (canal: Canal) => canal.recebidas.filter((m) => m.tipo === 'mensagem');

/** A mensagem de outra pessoa, como o servidor a repassa. */
const de = (p: Pessoa, texto: string): Mensagem => ({ tipo: 'mensagem', de: p.quem, nome: p.nome, voce: false, texto });
/** A resposta do servidor à mensagem da própria pessoa: só ela leva o id. */
const minha = (id: string, texto: string): Mensagem => ({
  tipo: 'mensagem',
  id,
  de: EU.quem,
  nome: EU.nome,
  voce: true,
  texto,
});

/** Quanto falta para o fim da lista, e onde ela está. */
const rolagem = (page: Page) =>
  lista(page).evaluate((l) => ({ topo: l.scrollTop, falta: l.scrollHeight - l.scrollTop - l.clientHeight }));
const noFim = (page: Page) => expect.poll(async () => (await rolagem(page)).falta).toBeLessThanOrEqual(1);

/** Na reunião, com o palco TRES e o chat aberto pelo botão dos controles. */
async function comOChatAberto(page: Page): Promise<NaReuniao> {
  const r = await naReuniaoCom(page, TRES);
  await oChat(page).click();
  await expect(painel(page)).toBeVisible();
  return r;
}

/** Escreve no campo e manda com o Enter. */
async function escrever(page: Page, texto: string): Promise<void> {
  await campo(page).fill(texto);
  await campo(page).press('Enter');
}

// ---- No PC (1280×800). ----

test('o Chat abre o painel ao lado, e os quadros se arrumam no que sobra', async ({ page }) => {
  await naReuniaoCom(page, TRES);
  expect((await caixa(area(page))).width).toBe(1232);
  await expect(painel(page)).toBeHidden();
  await expect(botao(page, 'Chat')).toHaveAttribute('aria-pressed', 'false');

  await botao(page, 'Chat').click();
  await expect(painel(page)).toBeVisible();
  await expect(painel(page)).toHaveAttribute('data-modo', 'lado');
  await expect(botao(page, 'Chat')).toHaveAttribute('aria-pressed', 'true');
  // O painel: 360 px, a 24 px da direita da janela e a 12 px da área, com a altura dela.
  await expect.poll(async () => (await caixa(area(page))).width).toBe(860);
  const a = await caixa(area(page));
  const p = await caixa(painel(page));
  expect(a.x).toBe(24);
  expect(p.width).toBe(360);
  expect(p.x + p.width).toBe(1280 - 24);
  expect(p.x - (a.x + a.width)).toBe(12);
  expect([p.y, p.height]).toEqual([a.y, a.height]);
  // Os quadros se arrumam no que sobra: todos dentro da área, e nenhum encosta no painel.
  await expect(async () => {
    for (const q of await todosOsQuadros(page).all()) dentro(await caixa(q), a, 'um quadro');
  }).toPass();
  expect(await todosOsQuadros(page).count()).toBe(4);
  // O Você continua no canto da área: 17% da largura dela, a 16 px do canto.
  const v = await caixa(quadro(page, 'voce'));
  await expect(quadro(page, 'voce')).toHaveAttribute('data-papel', 'canto');
  expect(v.width).toBeCloseTo(146, 0);
  expect(a.x + a.width - (v.x + v.width)).toBeCloseTo(16, 0);
  expect(a.y + a.height - (v.y + v.height)).toBeCloseTo(16, 0);

  // O que o painel mostra, vazio.
  await expect(tituloDoPainel(page)).toBeVisible();
  await expect(
    page.getByText('As mensagens são para todos da reunião e somem quando ela acaba.', { exact: true }),
  ).toBeVisible();
  await expect(nenhuma(page)).toBeVisible();
  await expect(mensagens(page)).toHaveCount(0);
  await expect(botao(page, 'Fechar o chat')).toBeVisible();
  await expect(botao(page, 'Voltar para a reunião')).toBeHidden();
  await expect(page.getByText('Você continua na reunião', { exact: true })).toBeHidden();
  await expect(semCanal(page)).toBeHidden();
  // O foco vai ao campo de escrever, que mostra o texto de dentro.
  await expect(campo(page)).toBeFocused();
  await expect(campo(page)).toHaveAttribute('placeholder', 'Escreva uma mensagem');
  // A lista é uma parada do Tab: quem usa só o teclado consegue rolar as mensagens.
  await expect(painel(page).getByRole('group', { name: 'Mensagens' })).toHaveAttribute('tabindex', '0');
  // Nada fica fora do teclado: o painel está ao lado, e não por cima.
  for (const s of FUNDO) await expect(page.locator(s)).not.toHaveAttribute('inert');
});

test('o Enter manda, e o Shift+Enter pula linha', async ({ page }) => {
  const { canal } = await comOChatAberto(page);
  await expect(campo(page)).toBeFocused();
  await page.keyboard.type('Bom dia');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('tudo bem?');
  await expect(campo(page)).toHaveValue('Bom dia\ntudo bem?');
  expect(mandadas(canal)).toEqual([]);

  await page.keyboard.press('Enter');
  await expect.poll(() => mandadas(canal)).toEqual([{ tipo: 'mensagem', id: 'm1', texto: 'Bom dia\ntudo bem?' }]);
  await expect(campo(page)).toHaveValue('');
  await expect(campo(page)).toBeFocused();
  // A mensagem já aparece, à direita, com a hora, mais apagada enquanto vai.
  const m = mensagem(page, 1);
  await expect(mensagens(page)).toHaveCount(1);
  await expect(nenhuma(page)).toBeHidden();
  await expect(m).toHaveAttribute('data-de', 'voce');
  await expect(m).toHaveAttribute('data-situacao', 'enviando');
  await expect(m).toHaveCSS('opacity', '0.6');
  await expect(m.locator('.mensagem-quem')).toHaveText('Você · 10:00');
  expect(await letras(page, 1)).toBe('Bom dia\ntudo bem?');
  const l = await caixa(lista(page));
  const b = await caixa(balao(page, 1));
  expect(l.x + l.width - (b.x + b.width)).toBeCloseTo(16, 0);
  // Em duas linhas: 2 × 14 px × 1,45, e os 9 px de cima e de baixo.
  expect(b.height).toBeCloseTo(58.6, 0);

  // A resposta do servidor a confirma.
  canal.mandar(minha('m1', 'Bom dia\ntudo bem?'));
  await expect(m).toHaveAttribute('data-situacao', 'enviada');
  await expect(m).toHaveCSS('opacity', '1');
  await expect(mensagens(page)).toHaveCount(1);
  await expect(tentarDeNovo(page, 1)).toHaveCount(0);
});

test('o botão de mandar', async ({ page }) => {
  const { canal } = await comOChatAberto(page);
  // Desligado com o campo vazio, só com espaços ou só com quebras de linha.
  await expect(mandar(page)).toBeDisabled();
  await campo(page).fill('   ');
  await expect(mandar(page)).toBeDisabled();
  await campo(page).fill('\n\n\n');
  await expect(mandar(page)).toBeDisabled();
  // O Enter também não manda o que não vale, e não pula linha.
  await campo(page).fill('  ');
  await campo(page).press('Enter');
  await expect(campo(page)).toHaveValue('  ');
  expect(mandadas(canal)).toEqual([]);

  await campo(page).fill(' Oi ');
  await expect(mandar(page)).toBeEnabled();
  await mandar(page).click();
  await expect.poll(() => mandadas(canal)).toEqual([{ tipo: 'mensagem', id: 'm1', texto: 'Oi' }]);
  // O campo esvazia, o foco volta a ele, e o botão desliga de novo.
  await expect(campo(page)).toHaveValue('');
  await expect(campo(page)).toBeFocused();
  await expect(mandar(page)).toBeDisabled();
  await expect(balao(page, 1)).toHaveText('Oi');
});

test('o Enter no meio de uma composição não manda', async ({ page }) => {
  const { canal } = await comOChatAberto(page);
  await campo(page).fill('にほんご');
  // A tecla no campo: a resposta diz se a página a tomou para si (o preventDefault).
  const tomada = (opcoes: { key: string; isComposing?: boolean; keyCode?: number }) =>
    campo(page).evaluate(
      (c, opcoes) => !c.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...opcoes })),
      opcoes,
    );
  // O Enter que confirma a composição (o IME) é do teclado, e não da página.
  expect(await tomada({ key: 'Enter', isComposing: true })).toBe(false);
  expect(await tomada({ key: 'Enter', keyCode: 229 })).toBe(false);
  // O Esc que cancela a composição também não fecha o chat.
  expect(await tomada({ key: 'Escape', isComposing: true })).toBe(false);
  await expect(painel(page)).toBeVisible();
  expect(mandadas(canal)).toEqual([]);
  await expect(campo(page)).toHaveValue('にほんご');
  // Fora da composição, a mesma tecla manda.
  expect(await tomada({ key: 'Enter' })).toBe(true);
  await expect.poll(() => mandadas(canal)).toEqual([{ tipo: 'mensagem', id: 'm1', texto: 'にほんご' }]);
});

test('o tab colado vira espaço, e o servidor não tem o que recusar', async ({ page }) => {
  // O servidor recusa o texto com um caractere de controle que não é a quebra de linha: a página o limpa antes.
  const { canal } = await comOChatAberto(page);
  await escrever(page, 'nome\tvalor\u0007');
  await expect.poll(() => mandadas(canal)).toEqual([{ tipo: 'mensagem', id: 'm1', texto: 'nome valor' }]);
  expect(await letras(page, 1)).toBe('nome valor');
});

test('a mensagem dos outros, com o nome e a hora', async ({ page }) => {
  const { canal } = await comOChatAberto(page);
  canal.mandar(de(CARLOS, 'Bom dia a todos'));
  const m = mensagem(page, 1);
  await expect(m).toHaveAttribute('data-de', 'outro');
  await expect(m).toHaveAttribute('data-situacao', 'enviada');
  await expect(m).toHaveCSS('opacity', '1');
  await expect(m.locator('.mensagem-quem')).toHaveText('Carlos Lima · 10:00');
  await expect(balao(page, 1)).toHaveText('Bom dia a todos');
  await expect(nenhuma(page)).toBeHidden();
  // À esquerda, a 16 px da beira da lista.
  const l = await caixa(lista(page));
  const b = await caixa(balao(page, 1));
  expect(b.x - l.x).toBeCloseTo(16, 0);

  // A hora é a de quando a mensagem chegou.
  await page.clock.runFor(60_000);
  canal.mandar(de(ANA, 'Oi'));
  await expect(mensagem(page, 2).locator('.mensagem-quem')).toHaveText('Ana Souza · 10:01');
  // Sem o nome, é o Participante.
  canal.mandar({ tipo: 'mensagem', de: BIA.quem, nome: '', voce: false, texto: 'Cheguei' });
  await expect(mensagem(page, 3).locator('.mensagem-quem')).toHaveText('Participante · 10:01');
  await expect(mensagens(page)).toHaveCount(3);
  expect(await mensagens(page).evaluateAll((ms) => ms.map((m) => (m as HTMLElement).dataset.mensagem))).toEqual([
    '1',
    '2',
    '3',
  ]);
});

test('o texto com sinais de HTML aparece como texto', async ({ page }) => {
  const { canal } = await comOChatAberto(page);
  const texto = '<img src=x onerror=alert(1)><b>oi</b><script>alert(2)</script>';
  canal.mandar(de(CARLOS, texto));
  await expect(mensagens(page)).toHaveCount(1);
  expect(await letras(page, 1)).toBe(texto);
  // O nome também: ele vem da pessoa.
  canal.mandar({ tipo: 'mensagem', de: ANA.quem, nome: '<i>Ana</i> & <b>cia</b>', voce: false, texto: 'x' });
  await expect(mensagem(page, 2).locator('.mensagem-quem')).toHaveText('<i>Ana</i> & <b>cia</b> · 10:00');
  // E a que a própria pessoa escreve.
  await escrever(page, texto);
  await expect(mensagens(page)).toHaveCount(3);
  expect(await letras(page, 3)).toBe(texto);
  expect(await painel(page).locator('img, b, i, script').count()).toBe(0);
});

test('o endereço vira um link que abre em outra aba', async ({ page, context }) => {
  // O site do link é de mentira: o pedido fica aqui, com o cabeçalho que diz de onde a pessoa veio.
  const deOndeVeio: Array<string | undefined> = [];
  await context.route('https://exemplo.com.br/**', (r) => {
    deOndeVeio.push(r.request().headers().referer);
    return r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<title>o relatório</title>' });
  });
  const { canal } = await comOChatAberto(page);
  canal.mandar(de(CARLOS, 'O link do relatório é https://exemplo.com.br/relatorio.'));
  const link = balao(page, 1).getByRole('link');
  await expect(link).toHaveCount(1);
  await expect(link).toHaveText('https://exemplo.com.br/relatorio');
  await expect(link).toHaveAttribute('href', 'https://exemplo.com.br/relatorio');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveCSS('color', 'rgb(127, 227, 232)');
  await expect(link).toHaveCSS('text-decoration-line', 'underline');
  // O ponto do fim fica fora do link, e o texto inteiro continua lá.
  expect(await letras(page, 1)).toBe('O link do relatório é https://exemplo.com.br/relatorio.');

  // O que não começa com http:// ou https:// não vira link.
  canal.mandar(de(CARLOS, 'javascript:alert(1) e www.exemplo.com.br'));
  await expect(balao(page, 2)).toHaveText('javascript:alert(1) e www.exemplo.com.br');
  await expect(balao(page, 2).getByRole('link')).toHaveCount(0);

  // O clique abre outra aba. O site do link não alcança a página da reunião (o window.opener) nem fica sabendo o
  // endereço dela, que leva o código do link (o Referer). E a reunião continua onde estava.
  const [outra] = await Promise.all([context.waitForEvent('page'), link.click()]);
  await expect(outra).toHaveURL('https://exemplo.com.br/relatorio');
  expect(await outra.evaluate(() => [window.opener, document.referrer])).toEqual([null, '']);
  expect(deOndeVeio).toEqual([undefined]);
  await outra.close();
  await expect(painel(page)).toBeVisible();
  await expect(controles(page)).toBeVisible();
});

// Um sinal que muda a direção do texto, na mensagem, não muda a ordem das letras do endereço: o link é escrito da
// esquerda para a direita, à parte do resto da frase. O endereço que aparece é o endereço para onde o link leva.
test('o endereço do link aparece como ele é, com sinais de direção na mensagem', async ({ page }) => {
  const { canal } = await comOChatAberto(page);
  const RLO = '‮';
  canal.mandar(de(CARLOS, `${RLO}veja https://exemplo.com.br/relatorio`));
  const link = balao(page, 1).getByRole('link');
  await expect(link).toHaveAttribute('href', 'https://exemplo.com.br/relatorio');
  await expect(link).toHaveText('https://exemplo.com.br/relatorio');
  await expect(link).toHaveAttribute('dir', 'ltr');
  await expect(link).toHaveCSS('direction', 'ltr');
  await expect(link).toHaveCSS('unicode-bidi', 'isolate');
  // O sinal dentro do endereço o termina: o que vem depois é texto, fora do link.
  canal.mandar(de(CARLOS, `https://exemplo.com.br/a${RLO}fdp.exe`));
  await expect(balao(page, 2).getByRole('link')).toHaveText('https://exemplo.com.br/a');
  await expect(balao(page, 2).getByRole('link')).toHaveAttribute('href', 'https://exemplo.com.br/a');
  // O endereço escrito ao contrário, logo depois do sinal, não vira link nenhum.
  canal.mandar(de(CARLOS, `https://${RLO}rb.moc.olpmexe@outro.example/`));
  await expect(mensagens(page)).toHaveCount(3);
  await expect(balao(page, 3).getByRole('link')).toHaveCount(0);
});

// Quem não vê a tela precisa ouvir que a mensagem dela não foi, e que o chat ficou sem o canal: sem isso, ela acha que
// a mensagem saiu.
test('o leitor de tela ouve a mensagem que não foi, e o chat sem o canal', async ({ page }) => {
  const { canal } = await comOChatAberto(page);
  await escrever(page, 'Primeira');
  await expect.poll(() => mandadas(canal)).toHaveLength(1);
  canal.mandar({ tipo: 'mensagemRecusada', id: 'm1', motivo: 'limite' });
  await expect(anuncio(page)).toHaveText('Não enviada: muitas mensagens seguidas. Espere um pouco.');
  // A que fica sem resposta em 10 s.
  await escrever(page, 'Segunda');
  await expect(mensagem(page, 2)).toHaveAttribute('data-situacao', 'enviando');
  await page.clock.runFor(10_000);
  await expect(anuncio(page)).toHaveText('Não enviada');
  // Cada uma é dita uma vez: a mensagem de outra pessoa toma o lugar, e um redesenho não repete a falha.
  canal.mandar(de(CARLOS, 'Bom dia'));
  await expect(anuncio(page)).toHaveText('Carlos Lima escreveu: Bom dia');
  await botao(page, 'Microfone').click();
  await expect(botao(page, 'Microfone')).toHaveAttribute('aria-pressed', 'false');
  await expect(anuncio(page)).toHaveText('Carlos Lima escreveu: Bom dia');
  // Com o chat fechado é igual: a mensagem que estava indo quando a pessoa fechou o painel.
  await escrever(page, 'Terceira');
  await expect(mensagem(page, 4)).toHaveAttribute('data-situacao', 'enviando');
  await page.keyboard.press('Escape');
  await expect(painel(page)).toBeHidden();
  await page.clock.runFor(10_000);
  await expect(anuncio(page)).toHaveText('Não enviada');
  // O canal cai com o chat aberto: o campo desliga, e o leitor de tela ouve por quê.
  await oChat(page).click();
  await expect(campo(page)).toBeEnabled();
  await canal.fechar(1006);
  await expect(campo(page)).toBeDisabled();
  await expect(anuncio(page)).toHaveText('O chat volta quando a conexão voltar.');
});

// Sem o canal, quem abre o chat ouve que ele está parado. Com a conexão caída, quem fala é o aviso da queda.
test('o leitor de tela ouve o chat sem o canal ao abrir, e a queda da conexão vem primeiro', async ({ page }) => {
  const { rede, canal } = await naReuniaoCom(page, TRES);
  await canal.fechar(1006);
  // Com o chat fechado, nada é dito: a pessoa não está no chat. (A página já tenta religar o canal, por trás.)
  await page.clock.runFor(2_000);
  await expect.poll(async () => (await rede.canalNumero(2)).tipos()).toEqual(['voltar']);
  await expect(anuncio(page)).toHaveText('Planejamento de dezembro');
  await oChat(page).click();
  await expect(painel(page)).toBeVisible();
  await expect(campo(page)).toBeDisabled();
  await expect(anuncio(page)).toHaveText('O chat volta quando a conexão voltar.');
  await botao(page, 'Fechar o chat').click();
  // A ligação cai com o chat aberto e sem o canal: o que se ouve é a queda.
  await oChat(page).click();
  await expect(anuncio(page)).toHaveText('O chat volta quando a conexão voltar.');
  await darNaLigacao(page, SEM_CONEXAO);
  await expect(cartaoDaQueda(page)).toBeVisible();
  await expect(anuncio(page)).toHaveText('A conexão caiu. Entrando de novo…');
});

test('a mensagem recusada pelo limite', async ({ page }) => {
  const { canal } = await comOChatAberto(page);
  await escrever(page, 'Primeira');
  await expect.poll(() => mandadas(canal)).toHaveLength(1);
  canal.mandar({ tipo: 'mensagemRecusada', id: 'm1', motivo: 'limite' });
  await expect(mensagem(page, 1)).toHaveAttribute('data-situacao', 'naoEnviada');
  await expect(mensagem(page, 1)).toHaveCSS('opacity', '1');
  await expect(mensagem(page, 1).locator('.mensagem-falha')).toHaveText(
    'Não enviada: muitas mensagens seguidas. Espere um pouco.',
  );
  await expect(tentarDeNovo(page, 1)).toBeEnabled();
  expect((await caixa(tentarDeNovo(page, 1))).height).toBeGreaterThanOrEqual(44);
  // O motivo e o Tentar de novo ficam do lado da mensagem: à direita, com o texto alinhado à direita.
  await expect(mensagem(page, 1).locator('.mensagem-falha')).toHaveCSS('text-align', 'right');
  const l = await caixa(lista(page));
  const t = await caixa(tentarDeNovo(page, 1));
  expect(l.x + l.width - (t.x + t.width)).toBeCloseTo(16, 0);

  // O Tentar de novo manda o mesmo texto, como uma mensagem nova, e o foco vai ao campo.
  await tentarDeNovo(page, 1).click();
  await expect
    .poll(() => mandadas(canal))
    .toEqual([
      { tipo: 'mensagem', id: 'm1', texto: 'Primeira' },
      { tipo: 'mensagem', id: 'm2', texto: 'Primeira' },
    ]);
  await expect(mensagem(page, 1)).toHaveCount(0);
  await expect(mensagem(page, 2)).toHaveAttribute('data-situacao', 'enviando');
  await expect(mensagem(page, 2).locator('.mensagem-falha')).toHaveCount(0);
  await expect(campo(page)).toBeFocused();

  // Recusada de novo, com outra mensagem depois dela: a que vai de novo sai do lugar e fica no fim da lista.
  canal.mandar({ tipo: 'mensagemRecusada', id: 'm2', motivo: 'limite' });
  await expect(tentarDeNovo(page, 2)).toBeVisible();
  canal.mandar(de(CARLOS, 'No meio'));
  await expect(mensagens(page)).toHaveCount(2);
  await tentarDeNovo(page, 2).click();
  await expect.poll(() => mandadas(canal).at(-1)).toEqual({ tipo: 'mensagem', id: 'm4', texto: 'Primeira' });
  await expect(mensagens(page).locator('.mensagem-texto')).toHaveText(['No meio', 'Primeira']);
  expect(await mensagens(page).evaluateAll((ms) => ms.map((m) => (m as HTMLElement).dataset.mensagem))).toEqual([
    '3',
    '4',
  ]);
});

test('a resposta que não chega', async ({ page }) => {
  const { canal } = await comOChatAberto(page);
  await escrever(page, 'Alguém me ouve?');
  await expect(mensagem(page, 1)).toHaveAttribute('data-situacao', 'enviando');
  await page.clock.runFor(9_999);
  await expect(mensagem(page, 1)).toHaveAttribute('data-situacao', 'enviando');
  await page.clock.runFor(1);
  await expect(mensagem(page, 1)).toHaveAttribute('data-situacao', 'naoEnviada');
  await expect(mensagem(page, 1).locator('.mensagem-falha')).toHaveText('Não enviada');
  await expect(tentarDeNovo(page, 1)).toBeEnabled();

  // A resposta que só atrasou ainda confirma a mensagem.
  canal.mandar(minha('m1', 'Alguém me ouve?'));
  await expect(mensagem(page, 1)).toHaveAttribute('data-situacao', 'enviada');
  await expect(mensagem(page, 1).locator('.mensagem-falha')).toHaveCount(0);
  await expect(tentarDeNovo(page, 1)).toHaveCount(0);
});

test('sem o canal, o campo fica desligado', async ({ page }) => {
  const { rede, canal } = await comOChatAberto(page);
  canal.mandar(de(CARLOS, 'Bom dia'));
  await escrever(page, 'Vai falhar');
  canal.mandar({ tipo: 'mensagemRecusada', id: 'm2', motivo: 'limite' });
  await expect(tentarDeNovo(page, 2)).toBeEnabled();
  await campo(page).fill('rascunho');
  await expect(campo(page)).toBeFocused();

  await canal.fechar(1006);
  await expect(campo(page)).toBeDisabled();
  await expect(mandar(page)).toBeDisabled();
  await expect(semCanal(page)).toBeVisible();
  await expect(semCanal(page)).toHaveText('O chat volta quando a conexão voltar.');
  await expect(tentarDeNovo(page, 2)).toBeDisabled();
  // As mensagens e o que a pessoa escrevia continuam lá, e o foco, que estava no campo, vai ao título do painel.
  await expect(mensagens(page)).toHaveCount(2);
  await expect(campo(page)).toHaveValue('rascunho');
  await expect(tituloDoPainel(page)).toBeFocused();

  // A página religa o canal por trás: enquanto ele volta, nada muda; com o voltou, o campo liga de novo.
  await page.clock.runFor(2_000);
  const volta = await rede.canalNumero(2);
  await expect.poll(() => volta.tipos()).toEqual(['voltar']);
  await expect(campo(page)).toBeDisabled();
  await expect(semCanal(page)).toBeVisible();
  volta.mandar({ tipo: 'voltou', volta: 'volta-2' });
  await expect(campo(page)).toBeEnabled();
  await expect(semCanal(page)).toBeHidden();
  await expect(tentarDeNovo(page, 2)).toBeEnabled();
  await expect(campo(page)).toHaveValue('rascunho');
  await expect(mandar(page)).toBeEnabled();
  await expect(mensagens(page)).toHaveCount(2);
});

test('o Esc fecha o chat e devolve o foco ao botão Chat', async ({ page }) => {
  await naReuniaoCom(page, TRES);
  await quadro(page, camDe(CARLOS)).click();
  await expect(quadro(page, camDe(CARLOS))).toHaveAttribute('data-papel', 'grande');
  await oChat(page).click();
  await expect(campo(page)).toBeFocused();

  // O Esc dentro do painel fecha só o chat: o Carlos continua aumentado.
  await page.keyboard.press('Escape');
  await expect(painel(page)).toBeHidden();
  await expect(oChat(page)).toBeFocused();
  await expect(oChat(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(quadro(page, camDe(CARLOS))).toHaveAttribute('data-papel', 'grande');
  // Outro Esc, com o foco no Chat, volta à grade.
  await page.keyboard.press('Escape');
  await expect(quadro(page, camDe(CARLOS))).toHaveAttribute('data-papel', 'grade');

  // O Fechar o chat faz o mesmo que o Esc.
  await oChat(page).click();
  await expect(campo(page)).toBeFocused();
  await botao(page, 'Fechar o chat').click();
  await expect(painel(page)).toBeHidden();
  await expect(oChat(page)).toBeFocused();
  // E o botão Chat abre e fecha.
  await oChat(page).click();
  await expect(painel(page)).toBeVisible();
  await oChat(page).click();
  await expect(painel(page)).toBeHidden();
  await expect(oChat(page)).toBeFocused();
  await expect.poll(async () => (await caixa(area(page))).width).toBe(1232);
});

test('a lista rolada', async ({ page }) => {
  const { canal } = await comOChatAberto(page);
  for (let i = 1; i <= 40; i++) canal.mandar(de(CARLOS, `Mensagem ${i}`));
  await expect(mensagens(page)).toHaveCount(40);
  // Quem está no fim acompanha.
  await noFim(page);

  // Quem lê as antigas não é puxado para o fim.
  await lista(page).evaluate((l) => {
    l.scrollTop = 0;
  });
  canal.mandar(de(CARLOS, 'Mais uma'));
  await expect(mensagens(page)).toHaveCount(41);
  expect((await rolagem(page)).topo).toBe(0);
  // A mensagem que a própria pessoa manda leva ao fim.
  await escrever(page, 'A minha');
  await expect(mensagens(page)).toHaveCount(42);
  await noFim(page);
  // No fim, chega outra: ela continua no fim.
  canal.mandar(de(ANA, 'E outra'));
  await expect(mensagens(page)).toHaveCount(43);
  await noFim(page);
  // O campo que cresce encolhe a lista, e ela continua no fim.
  await campo(page).fill('1\n2\n3\n4\n5');
  await expect.poll(async () => (await caixa(campo(page))).height).toBeGreaterThan(100);
  await noFim(page);
  await campo(page).fill('');

  // Só a mensagem que chega puxa a lista: a 50 px do fim, outra mudança da tela (o microfone) a deixa onde está.
  await lista(page).evaluate((l) => {
    l.scrollTop = l.scrollHeight - l.clientHeight - 50;
  });
  const perto = (await rolagem(page)).topo;
  await botao(page, 'Microfone').click();
  await page.clock.runFor(10);
  await expect(botao(page, 'Microfone')).toHaveAttribute('aria-pressed', 'false');
  expect((await rolagem(page)).topo).toBe(perto);

  // A até 80 px do fim, ela ainda acompanha; a mais que isso, fica onde está.
  await lista(page).evaluate((l) => {
    l.scrollTop = l.scrollHeight - l.clientHeight - 80;
  });
  canal.mandar(de(ANA, 'Perto do fim'));
  await expect(mensagens(page)).toHaveCount(44);
  await noFim(page);
  await lista(page).evaluate((l) => {
    l.scrollTop = l.scrollHeight - l.clientHeight - 81;
  });
  const antes = (await rolagem(page)).topo;
  canal.mandar(de(ANA, 'Longe do fim'));
  await expect(mensagens(page)).toHaveCount(45);
  expect((await rolagem(page)).topo).toBe(antes);

  // O painel que abre mostra o fim.
  await lista(page).evaluate((l) => {
    l.scrollTop = 0;
  });
  await botao(page, 'Fechar o chat').click();
  await expect(painel(page)).toBeHidden();
  await oChat(page).click();
  await expect(painel(page)).toBeVisible();
  await noFim(page);
});

test('o texto fora do comum', async ({ page }) => {
  const { canal } = await comOChatAberto(page);
  const textos = [
    `https://exemplo.com.br/${'a'.repeat(877)}`, // um endereço de 900 letras
    'k'.repeat(1000),
    '😀'.repeat(50),
    'مرحبا بكم في الاجتماع',
  ];
  for (const t of textos) canal.mandar(de(CARLOS, t));
  // A própria pessoa também manda a palavra de 1.000 letras.
  await escrever(page, 'k'.repeat(1000));
  await expect(mensagens(page)).toHaveCount(5);

  // O texto está como foi escrito, e o endereço inteiro é o link.
  for (const [i, t] of textos.entries()) expect(await letras(page, i + 1)).toBe(t);
  await expect(balao(page, 1).getByRole('link')).toHaveAttribute('href', textos[0]);
  // Nada alarga o painel: a lista não rola para o lado, e cada balão cabe nela.
  expect(await lista(page).evaluate((l) => l.scrollWidth - l.clientWidth)).toBeLessThanOrEqual(0);
  expect((await caixa(painel(page))).width).toBe(360);
  const l = await caixa(lista(page));
  for (let n = 1; n <= 5; n++) {
    const b = await caixa(balao(page, n));
    expect(b.x, `o balão ${n}: a esquerda`).toBeGreaterThanOrEqual(l.x + 16 - 1);
    expect(b.x + b.width, `o balão ${n}: a direita`).toBeLessThanOrEqual(l.x + l.width - 16 + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // O texto da direita para a esquerda fica na direção dele.
  expect(await balao(page, 4).evaluate((b) => getComputedStyle(b).direction)).toBe('rtl');
  expect(await balao(page, 2).evaluate((b) => getComputedStyle(b).direction)).toBe('ltr');
});

test('o campo cresce até 120 px e não passa de 1.000 letras', async ({ page }) => {
  const { canal } = await comOChatAberto(page);
  expect((await caixa(campo(page))).height).toBe(44);
  const rolaPorDentro = () => campo(page).evaluate((c) => getComputedStyle(c).overflowY === 'auto');
  await campo(page).fill('uma\nduas');
  const duas = (await caixa(campo(page))).height;
  expect(duas).toBeGreaterThan(44);
  expect(duas).toBeLessThan(120);
  // O texto cabe inteiro, sem barra de rolagem.
  expect(await campo(page).evaluate((c) => c.scrollHeight <= c.clientHeight)).toBe(true);
  expect(await rolaPorDentro()).toBe(false);
  // Com 8 linhas, ele para nos 120 px e rola por dentro.
  await campo(page).fill(Array.from({ length: 8 }, (_, i) => `linha ${i + 1}`).join('\n'));
  expect((await caixa(campo(page))).height).toBe(120);
  expect(await campo(page).evaluate((c) => c.scrollHeight > c.clientHeight)).toBe(true);
  expect(await rolaPorDentro()).toBe(true);
  // Depois de mandar, ele volta ao tamanho de uma linha.
  await campo(page).press('Enter');
  await expect.poll(() => mandadas(canal)).toHaveLength(1);
  await expect(campo(page)).toHaveValue('');
  expect((await caixa(campo(page))).height).toBe(44);

  // 1.005 letras digitadas: o campo fica com 1.000.
  await campo(page).fill('a'.repeat(998));
  await campo(page).pressSequentially('1234567');
  const valor = await campo(page).inputValue();
  expect(valor.length).toBe(1000);
  expect(valor.endsWith('aa12')).toBe(true);
  await expect(campo(page)).toHaveAttribute('maxlength', '1000');
});

// O chat ao lado dos quadros não é outra tela, e não mexe no histórico do navegador. Cobrindo a janela (a janela
// estreita), ele ganha a entrada dele, e o Voltar do navegador o fecha.
test('ao lado, o chat não mexe no histórico; cobrindo a janela, o Voltar o fecha', async ({ page }) => {
  await comOChatAberto(page);
  const estadoDoHistorico = () => page.evaluate(() => history.state as unknown);
  const entradas = await page.evaluate(() => history.length);
  await expect(painel(page)).toHaveAttribute('data-modo', 'lado');
  expect(await estadoDoHistorico()).toBeNull();
  expect(await page.evaluate(() => history.length)).toBe(entradas);
  // A janela estreita: o painel passa a cobrir, e ganha a entrada. De volta à larga, a entrada sai, e o chat fica.
  await page.setViewportSize({ width: 800, height: 700 });
  await expect(painel(page)).toHaveAttribute('data-modo', 'cobre');
  await expect.poll(estadoDoHistorico).toEqual({ chatDaReuniao: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(painel(page)).toHaveAttribute('data-modo', 'lado');
  await expect.poll(estadoDoHistorico).toBeNull();
  await expect(painel(page)).toBeVisible();
  // Estreita de novo, e o Voltar do navegador: o chat fecha, e a reunião continua.
  await page.setViewportSize({ width: 800, height: 700 });
  await expect.poll(estadoDoHistorico).toEqual({ chatDaReuniao: true });
  await page.goBack();
  await expect(painel(page)).toBeHidden();
  await expect(controles(page)).toBeVisible();
  await expect(titulo(page, 'Planejamento de dezembro')).toBeVisible();
});

test('a janela que cruza os 900', async ({ page }) => {
  await comOChatAberto(page);
  await campo(page).fill('rascunho');
  await expect(campo(page)).toBeFocused();

  // Abaixo dos 900 px, o painel cobre a janela inteira, e o que fica atrás sai do teclado.
  await page.setViewportSize({ width: 880, height: 800 });
  await expect(painel(page)).toHaveAttribute('data-modo', 'cobre');
  await expect.poll(() => caixa(painel(page))).toEqual({ x: 0, y: 0, width: 880, height: 800 });
  await expect(botao(page, 'Voltar para a reunião')).toBeVisible();
  await expect(botao(page, 'Fechar o chat')).toBeHidden();
  await expect(page.getByText('Você continua na reunião', { exact: true })).toBeVisible();
  for (const s of FUNDO) await expect(page.locator(s)).toHaveAttribute('inert');
  // O que a pessoa escrevia e o foco continuam.
  await expect(campo(page)).toHaveValue('rascunho');
  await expect(campo(page)).toBeFocused();

  // De volta aos 1280 px: ao lado de novo.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(painel(page)).toHaveAttribute('data-modo', 'lado');
  await expect.poll(async () => (await caixa(painel(page))).width).toBe(360);
  await expect.poll(async () => (await caixa(area(page))).width).toBe(860);
  for (const s of FUNDO) await expect(page.locator(s)).not.toHaveAttribute('inert');
  await expect(botao(page, 'Fechar o chat')).toBeVisible();
  await expect(campo(page)).toHaveValue('rascunho');
  await expect(campo(page)).toBeFocused();

  // O foco que ficaria atrás do painel vai ao título dele.
  await botao(page, 'Microfone').focus();
  await page.setViewportSize({ width: 880, height: 800 });
  await expect(painel(page)).toHaveAttribute('data-modo', 'cobre');
  await expect(tituloDoPainel(page)).toBeFocused();
});

test('o Sair com o chat aberto, e o Entrar de novo começa vazio', async ({ page }) => {
  const { canal } = await comOChatAberto(page);
  canal.mandar(de(CARLOS, 'Bom dia'));
  await escrever(page, 'Oi');
  await expect(mensagens(page)).toHaveCount(2);
  await campo(page).fill('rascunho');

  await botao(page, 'Sair').click();
  await expect(titulo(page, 'Você saiu da reunião')).toBeVisible();
  await expect(painel(page)).toBeHidden();

  const senhas = () => canal.tipos().filter((t) => t === 'senha').length;
  const antes = senhas();
  await botao(page, 'Entrar de novo').click();
  await expect.poll(senhas).toBe(antes + 1);
  canal.mandar({ tipo: 'senha', senha: 'senha-2' });
  await subir(page, () => controles(page).isVisible());
  // A reunião volta com o chat fechado e vazio: nem as mensagens, nem o que a pessoa escrevia.
  await expect(painel(page)).toBeHidden();
  await expect(oChat(page)).toHaveAttribute('aria-pressed', 'false');
  await oChat(page).click();
  await expect(painel(page)).toBeVisible();
  await expect(mensagens(page)).toHaveCount(0);
  await expect(nenhuma(page)).toBeVisible();
  await expect(campo(page)).toHaveValue('');
  await expect(mandar(page)).toBeDisabled();
  expect((await caixa(campo(page))).height).toBe(44);
  // Os números das mensagens não se repetem: a resposta atrasada de uma antiga não confirma uma nova.
  await escrever(page, 'De volta');
  await expect.poll(() => mandadas(canal).at(-1)).toEqual({ tipo: 'mensagem', id: 'm3', texto: 'De volta' });
});

test('a conexão que cai e volta deixa as mensagens', async ({ page }) => {
  const { canal } = await comOChatAberto(page);
  canal.mandar(de(CARLOS, 'Bom dia'));
  await escrever(page, 'Oi');
  canal.mandar(minha('m2', 'Oi'));
  await expect(mensagem(page, 2)).toHaveAttribute('data-situacao', 'enviada');

  await darNaLigacao(page, SEM_CONEXAO);
  await expect(cartaoDaQueda(page)).toBeVisible();
  // O cartão cobre a área dos quadros, e o painel fica como estava, ao lado dela.
  const a = await caixa(area(page));
  expect(await caixa(page.locator('.caiu'))).toEqual(a);
  expect((await caixa(painel(page))).x).toBe(a.x + a.width + 12);
  await expect(mensagens(page).locator('.mensagem-texto')).toHaveText(['Bom dia', 'Oi']);
  // O canal continua aberto: dá para escrever enquanto a ligação volta.
  await expect(campo(page)).toBeEnabled();
  await expect(semCanal(page)).toBeHidden();

  await voltar(page, canal);
  await expect(mensagens(page).locator('.mensagem-texto')).toHaveText(['Bom dia', 'Oi']);
  await expect(oChat(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(painel(page)).toBeVisible();
});

// ---- Com o chat fechado: o número no botão, o aviso curto e o leitor de tela. ----

test('com o chat fechado, o número no botão e o aviso curto', async ({ page }) => {
  const { canal } = await naReuniaoCom(page, TRES);
  await expect(numero(page)).toBeHidden();
  await expect(aviso(page)).toBeHidden();
  await expect(botao(page, 'Chat')).toBeVisible();

  canal.mandar(de(CARLOS, 'Bom dia a todos'));
  // O botão mostra o 1 e passa a se chamar "Chat, 1 mensagem nova"; o número é só o desenho.
  await expect(numero(page)).toBeVisible();
  await expect(numero(page)).toHaveText('1');
  await expect(numero(page)).toHaveAttribute('aria-hidden', 'true');
  await expect(botao(page, 'Chat, 1 mensagem nova')).toBeVisible();
  await expect(oChat(page)).toHaveAttribute('aria-pressed', 'false');
  const n = await caixa(numero(page));
  expect([n.width, n.height]).toEqual([22, 22]);
  await expect(numero(page)).toHaveCSS('background-color', 'rgb(0, 194, 203)');
  // O aviso: quem escreveu, o texto e o Abrir o chat.
  await expect(aviso(page)).toBeVisible();
  await expect(aviso(page)).toHaveAttribute('data-tipo', 'mensagem');
  await expect(quemEscreveu(page)).toHaveText('Carlos Lima escreveu');
  await expect(linhaDoAviso(page)).toHaveText('Bom dia a todos');
  await expect(abrirOChat(page)).toBeVisible();
  expect((await caixa(abrirOChat(page))).height).toBeGreaterThanOrEqual(44);
  await expect(anuncio(page)).toHaveText('Carlos Lima escreveu: Bom dia a todos');

  // 5 s depois o aviso some, e o número fica.
  await page.clock.runFor(4_999);
  await expect(aviso(page)).toBeVisible();
  await page.clock.runFor(1);
  await expect(aviso(page)).toBeHidden();
  await expect(numero(page)).toHaveText('1');
  // Sem o nome, quem escreveu é o Participante.
  canal.mandar({ tipo: 'mensagem', de: BIA.quem, nome: '', voce: false, texto: 'Cheguei' });
  await expect(quemEscreveu(page)).toHaveText('Participante escreveu');
  await expect(botao(page, 'Chat, 2 mensagens novas')).toBeVisible();
  // Com 10 mensagens, o botão mostra 9+ e diz o número de verdade.
  for (let i = 3; i <= 10; i++) canal.mandar(de(ANA, `Mensagem ${i}`));
  await expect(numero(page)).toHaveText('9+');
  await expect(botao(page, 'Chat, 10 mensagens novas')).toBeVisible();
});

test('um aviso por vez', async ({ page }) => {
  const { canal } = await naReuniaoCom(page, TRES);
  canal.mandar(de(CARLOS, 'Primeira'));
  await expect(linhaDoAviso(page)).toHaveText('Primeira');
  await page.clock.runFor(3_000);
  canal.mandar(de(ANA, 'Segunda'));
  // O aviso novo toma o lugar do anterior, e o tempo dele é o seu: 5 s depois da segunda.
  await expect(quemEscreveu(page)).toHaveText('Ana Souza escreveu');
  await expect(linhaDoAviso(page)).toHaveText('Segunda');
  await expect(aviso(page)).toHaveCount(1);
  await page.clock.runFor(2_000);
  await expect(aviso(page)).toBeVisible();
  await page.clock.runFor(2_999);
  await expect(aviso(page)).toBeVisible();
  await page.clock.runFor(1);
  await expect(aviso(page)).toBeHidden();

  // A rajada: 30 mensagens seguidas, e um aviso só na página, com a última.
  for (let i = 1; i <= 30; i++) canal.mandar(de(CARLOS, `Mensagem ${i}`));
  await expect(linhaDoAviso(page)).toHaveText('Mensagem 30');
  await expect(aviso(page)).toHaveCount(1);
  await expect(page.locator('.aviso-curto:visible')).toHaveCount(1);
  await expect(numero(page)).toHaveText('9+');
  await expect(botao(page, 'Chat, 32 mensagens novas')).toBeVisible();
});

test('o Abrir o chat do aviso', async ({ page }) => {
  const { canal } = await naReuniaoCom(page, TRES);
  canal.mandar(de(CARLOS, 'Oi'));
  await abrirOChat(page).click();
  await expect(painel(page)).toBeVisible();
  await expect(aviso(page)).toBeHidden();
  await expect(numero(page)).toBeHidden();
  // Sem mensagem nova, o botão volta a se chamar só Chat.
  await expect(botao(page, 'Chat')).toHaveAttribute('aria-pressed', 'true');
  await expect(campo(page)).toBeFocused();
  await expect(balao(page, 1)).toHaveText('Oi');
  // Com o chat aberto, a mensagem que chega não conta nem avisa.
  canal.mandar(de(ANA, 'Bom dia'));
  await expect(mensagens(page)).toHaveCount(2);
  await expect(aviso(page)).toBeHidden();
  await expect(numero(page)).toBeHidden();
  // Fechado de novo, a contagem recomeça do zero.
  await page.keyboard.press('Escape');
  canal.mandar(de(ANA, 'Mais uma'));
  await expect(numero(page)).toHaveText('1');
});

test('o aviso fica no meio, logo acima dos controles', async ({ page }) => {
  const { canal } = await naReuniaoCom(page, TRES);
  canal.mandar(de(CARLOS, 'Bom dia a todos'));
  await expect(aviso(page)).toBeVisible();
  const a = await caixa(area(page));
  const t = await caixa(aviso(page));
  // No meio da área dos quadros, a 8 px do fundo dela, com 440 px.
  expect(Math.abs(t.x + t.width / 2 - (a.x + a.width / 2))).toBeLessThanOrEqual(2);
  expect(a.y + a.height - (t.y + t.height)).toBeCloseTo(8, 0);
  expect(t.width).toBe(440);
  // Por cima dos quadros: o ponto do meio dele é dele.
  expect(
    await aviso(page).evaluate((el) => {
      const c = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2));
    }),
  ).toBe(true);
});

/** O aviso de uma mensagem do Carlos, com o palco TRES: dentro da área, sem encostar no Você do canto. */
async function oAvisoEOVoce(page: Page) {
  const { canal } = await naReuniaoCom(page, TRES);
  canal.mandar(de(CARLOS, 'Bom dia a todos, tudo bem com vocês?'));
  await expect(aviso(page)).toBeVisible();
  const a = await caixa(area(page));
  const v = await caixa(page.locator('[data-papel="canto"]'));
  const t = await caixa(aviso(page));
  dentro(t, a, 'o aviso');
  const separados =
    t.x + t.width <= v.x || v.x + v.width <= t.x || t.y + t.height <= v.y || v.y + v.height <= t.y;
  expect(separados, `o aviso ${JSON.stringify(t)} e o Você ${JSON.stringify(v)}`).toBe(true);
  return { a, v, t };
}

test('o aviso não cobre o Você', async ({ page }) => {
  // Em 1280×800 a área é larga: o aviso fica no meio, embaixo, e o Você no canto, ao lado dele.
  const { a, t } = await oAvisoEOVoce(page);
  expect(a.width).toBe(1232);
  expect(a.y + a.height - (t.y + t.height)).toBeCloseTo(8, 0);
});

test.describe('na janela de 1000×700', () => {
  test.use({ viewport: { width: 1000, height: 700 } });

  test('o aviso não cobre o Você: ainda cabe ao lado', async ({ page }) => {
    const { a, t } = await oAvisoEOVoce(page);
    expect(a.width).toBe(952);
    expect(a.y + a.height - (t.y + t.height)).toBeCloseTo(8, 0);
  });
});

test.describe('na janela de 808×700, com a área de 760 px', () => {
  test.use({ viewport: { width: 808, height: 700 } });

  test('o aviso não cobre o Você: sobe para cima dele', async ({ page }) => {
    // Com a área de até 760 px, o aviso no meio cobriria o Você: ele sobe para 8 px acima dele.
    const { a, v, t } = await oAvisoEOVoce(page);
    expect(a.width).toBe(760);
    expect(v.y - (t.y + t.height)).toBeCloseTo(8, 0);
    expect(t.width).toBe(440);
  });
});

test.describe('na janela de 809×700, com a área de 761 px', () => {
  test.use({ viewport: { width: 809, height: 700 } });

  test('o aviso fica embaixo: a área tem mais de 760 px', async ({ page }) => {
    const { a, t } = await oAvisoEOVoce(page);
    expect(a.width).toBe(761);
    expect(a.y + a.height - (t.y + t.height)).toBeCloseTo(8, 0);
  });
});

test('o texto do aviso é texto, numa linha', async ({ page }) => {
  const { canal } = await naReuniaoCom(page, TRES);
  canal.mandar(de(CARLOS, '<b>oi</b>\nsegunda linha'));
  await expect(linhaDoAviso(page)).toHaveText('<b>oi</b> segunda linha');
  expect(await aviso(page).locator('b').count()).toBe(0);
  // Uma linha: 14 px × 1,4.
  expect((await caixa(linhaDoAviso(page))).height).toBeCloseTo(19.6, 0);
  const comUmaLinha = (await caixa(aviso(page))).height;

  // O texto de 1.000 letras é cortado com reticências, sem alargar o aviso nem dobrar a linha.
  canal.mandar(de(CARLOS, 'k'.repeat(1000)));
  await expect(linhaDoAviso(page)).toHaveText('k'.repeat(1000));
  expect(await caixa(aviso(page))).toMatchObject({ width: 440, height: comUmaLinha });
  expect(
    await linhaDoAviso(page).evaluate(
      (l) => l.scrollWidth > l.clientWidth && getComputedStyle(l).textOverflow === 'ellipsis',
    ),
  ).toBe(true);
  // O nome comprido, com sinais de HTML, também: é texto, numa linha, e o botão continua inteiro no aviso.
  canal.mandar({ tipo: 'mensagem', de: ANA.quem, nome: `<i>${'N'.repeat(70)}</i>`, voce: false, texto: 'x' });
  await expect(quemEscreveu(page)).toHaveText(`<i>${'N'.repeat(70)}</i> escreveu`);
  expect(await aviso(page).locator('i').count()).toBe(0);
  const t = await caixa(aviso(page));
  expect(t).toMatchObject({ width: 440, height: comUmaLinha });
  dentro(await caixa(abrirOChat(page)), t, 'o Abrir o chat');
});

test('o leitor de tela ouve cada mensagem dos outros, também a repetida', async ({ page }) => {
  const { canal } = await naReuniaoCom(page, TRES);
  // Cada texto que entra na região que os leitores de tela anunciam.
  await page.evaluate(() => {
    const w = window as unknown as { ditos: string[] };
    w.ditos = [];
    const regiao = document.querySelector('[data-campo="anuncio"]') as HTMLElement;
    new MutationObserver((mudancas) => {
      for (const m of mudancas) for (const no of m.addedNodes) w.ditos.push(no.textContent ?? '');
    }).observe(regiao, { childList: true });
  });
  const ditos = () => page.evaluate(() => (window as unknown as { ditos: string[] }).ditos);

  // Duas mensagens iguais: a região muda duas vezes.
  canal.mandar(de(CARLOS, 'Oi'));
  canal.mandar(de(CARLOS, 'Oi'));
  await expect.poll(ditos).toEqual(['Carlos Lima escreveu: Oi', 'Carlos Lima escreveu: Oi']);
  // Com o chat aberto, ela também muda, e o texto vai numa linha.
  await oChat(page).click();
  await expect(painel(page)).toBeVisible();
  canal.mandar(de(ANA, 'linha 1\nlinha 2'));
  await expect.poll(ditos).toEqual([
    'Carlos Lima escreveu: Oi',
    'Carlos Lima escreveu: Oi',
    'Ana Souza escreveu: linha 1 linha 2',
  ]);
  // A mensagem da própria pessoa não é dita: nem quando sai, nem quando a resposta chega.
  await escrever(page, 'A minha');
  canal.mandar(minha('m4', 'A minha'));
  await expect(mensagem(page, 4)).toHaveAttribute('data-situacao', 'enviada');
  expect(await ditos()).toHaveLength(3);

  // Quem fala é a região de sempre; o aviso que aparece não é uma região falada, para a mensagem não ser dita duas
  // vezes.
  await expect(regiaoFalada(page)).toHaveAttribute('aria-live', 'polite');
  await expect(regiaoFalada(page)).toHaveAttribute('aria-atomic', 'false');
  expect(
    await aviso(page).evaluate((el) => [
      el.getAttribute('role'),
      el.getAttribute('aria-live'),
      el.closest('[aria-live], [role="status"], [role="alert"]') === null,
    ]),
  ).toEqual([null, null, true]);
});

// ---- No celular (390×844, com o toque). ----

test.describe('no celular', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('os quatro controles, e o painel que cobre a tela', async ({ page }) => {
    await naReuniaoCom(page, TRES);
    // Microfone, Câmera, Chat e Sair, numa linha só, cada um com o tamanho do toque.
    const botoes = controles(page).getByRole('button');
    await expect(botoes).toHaveText(['Microfone', 'Câmera', 'Chat', 'Sair']);
    const caixas = await Promise.all((await botoes.all()).map((b) => caixa(b)));
    expect(new Set(caixas.map((c) => Math.round(c.y))).size).toBe(1);
    for (const c of caixas) {
      expect(c.width).toBeGreaterThanOrEqual(44);
      expect(c.height).toBeGreaterThanOrEqual(44);
    }
    expect(Math.min(...caixas.map((c) => c.x))).toBeCloseTo(12, 0);
    expect(Math.max(...caixas.map((c) => c.x + c.width))).toBeCloseTo(390 - 12, 0);

    await oChat(page).tap();
    await expect(painel(page)).toBeVisible();
    await expect(painel(page)).toHaveAttribute('data-modo', 'cobre');
    await expect.poll(() => caixa(painel(page))).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    await expect(tituloDoPainel(page)).toBeVisible();
    await expect(page.getByText('Você continua na reunião', { exact: true })).toBeVisible();
    await expect(botao(page, 'Voltar para a reunião')).toBeVisible();
    await expect(botao(page, 'Fechar o chat')).toBeHidden();
    expect((await caixa(botao(page, 'Voltar para a reunião'))).width).toBeGreaterThanOrEqual(44);
    // O que fica atrás do painel sai do teclado e dos leitores de tela.
    for (const s of FUNDO) await expect(page.locator(s)).toHaveAttribute('inert');
    // O foco vai ao título do painel, e não ao campo: o teclado só sobe quando a pessoa toca no campo.
    await expect(tituloDoPainel(page)).toBeFocused();
    await expect(campo(page)).not.toBeFocused();
    await expect(campo(page)).toBeEnabled();

    await botao(page, 'Voltar para a reunião').tap();
    await expect(painel(page)).toBeHidden();
    await expect(oChat(page)).toBeFocused();
    for (const s of FUNDO) await expect(page.locator(s)).not.toHaveAttribute('inert');
    await expect(todosOsQuadros(page)).toHaveCount(4);
    await expect(quadro(page, camDe(CARLOS))).toBeVisible();
  });

  // O Voltar do aparelho (o botão do Android, o gesto do iPhone), com o chat cobrindo a tela, fecha o chat, e a pessoa
  // continua na reunião. Sem isso ele saía da página: o chat parece outra tela, com uma seta de voltar no alto.
  test('no celular, o Voltar do aparelho fecha o chat, e a pessoa continua na reunião', async ({ page }) => {
    const { canal } = await naReuniaoCom(page, TRES);
    await page.evaluate(() => {
      (window as unknown as { aMesmaPagina?: boolean }).aMesmaPagina = true;
    });
    const estadoDoHistorico = () => page.evaluate(() => history.state as unknown);
    expect(await estadoDoHistorico()).toBeNull();
    await oChat(page).tap();
    await expect(painel(page)).toBeVisible();
    await expect.poll(estadoDoHistorico).toEqual({ chatDaReuniao: true });

    await page.goBack();
    // A página é a mesma (não saiu nem recarregou), na reunião, com o chat fechado.
    expect(await page.evaluate(() => (window as unknown as { aMesmaPagina?: boolean }).aMesmaPagina)).toBe(true);
    await expect(painel(page)).toBeHidden();
    await expect(controles(page)).toBeVisible();
    await expect(todosOsQuadros(page)).toHaveCount(4);
    for (const s of FUNDO) await expect(page.locator(s)).not.toHaveAttribute('inert');
    expect(await estadoDoHistorico()).toBeNull();

    // Fechado pela seta do alto, a entrada do chat sai do histórico: o Voltar seguinte não é mais do chat.
    await oChat(page).tap();
    await expect.poll(estadoDoHistorico).toEqual({ chatDaReuniao: true });
    await botao(page, 'Voltar para a reunião').tap();
    await expect(painel(page)).toBeHidden();
    await expect.poll(estadoDoHistorico).toBeNull();
    // Aberto, fechado e aberto de novo de uma vez só, antes de o navegador desfazer a entrada do fechar: o chat fica
    // aberto, com a entrada dele.
    await page.evaluate(() => {
      const chat = document.querySelector('button[data-botao="chat"]') as HTMLButtonElement;
      chat.click();
      (document.querySelector('.painel-voltar') as HTMLButtonElement).click();
      chat.click();
    });
    await expect.poll(estadoDoHistorico).toEqual({ chatDaReuniao: true });
    await expect(painel(page)).toBeVisible();
    await page.goBack();
    await expect(painel(page)).toBeHidden();
    await expect(controles(page)).toBeVisible();
    await oChat(page).tap();
    await expect(painel(page)).toBeVisible();

    // A pessoa é tirada com o chat aberto: a tela muda, e a entrada do chat não fica para trás.
    canal.mandar({ tipo: 'tirado' });
    await expect(titulo(page, 'Você foi tirado da reunião')).toBeVisible();
    await expect.poll(estadoDoHistorico).toBeNull();
  });

  test('no celular, o Enter pula linha e o botão manda', async ({ page }) => {
    const { canal } = await naReuniaoCom(page, TRES);
    await oChat(page).tap();
    await campo(page).tap();
    await expect(campo(page)).toBeFocused();
    await page.keyboard.type('Bom dia');
    await page.keyboard.press('Enter');
    await page.keyboard.type('tudo bem?');
    await expect(campo(page)).toHaveValue('Bom dia\ntudo bem?');
    expect(mandadas(canal)).toEqual([]);

    await mandar(page).tap();
    await expect.poll(() => mandadas(canal)).toEqual([{ tipo: 'mensagem', id: 'm1', texto: 'Bom dia\ntudo bem?' }]);
    await expect(campo(page)).toHaveValue('');
    // O foco volta ao campo: o teclado não desce.
    await expect(campo(page)).toBeFocused();
    // As medidas do celular: a letra de 16 px no campo (com menos, o iPhone aproxima a tela), o campo e o botão de
    // 46 px, e o balão com a letra de 15 px e até 86% da largura.
    await expect(campo(page)).toHaveCSS('font-size', '16px');
    expect((await caixa(campo(page))).height).toBe(46);
    expect(await caixa(mandar(page))).toMatchObject({ width: 46, height: 46 });
    await expect(balao(page, 1)).toHaveCSS('font-size', '15px');
    canal.mandar(de(CARLOS, 'k'.repeat(1000)));
    const l = await caixa(lista(page));
    await expect.poll(async () => (await caixa(balao(page, 2))).width).toBeCloseTo((l.width - 28) * 0.86, 0);
  });

  test('o teclado do celular', async ({ page }) => {
    // O teclado da tela não muda a janela: ele encolhe a parte visível dela (o visualViewport), que é de mentira aqui.
    // Até o teste dar outra, a altura dela é a da janela.
    await page.addInitScript(() => {
      let altura: number | null = null;
      const falso = Object.assign(new EventTarget(), { offsetLeft: 0, offsetTop: 0, scale: 1 });
      Object.defineProperty(falso, 'width', { get: () => window.innerWidth });
      Object.defineProperty(falso, 'height', {
        get: () => altura ?? window.innerHeight,
        set: (a: number) => {
          altura = a;
        },
      });
      Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => falso });
    });
    const visivel = (medidas: { height: number; offsetTop: number; scale?: number }, evento: 'resize' | 'scroll') =>
      page.evaluate(
        ({ medidas, evento }) => {
          const v = window.visualViewport as unknown as EventTarget & Record<string, number>;
          Object.assign(v, medidas);
          v.dispatchEvent(new Event(evento));
        },
        { medidas, evento },
      );
    const medidasNoStyle = () =>
      page.locator('.painel').evaluate((p: HTMLElement) => [p.style.top, p.style.height, p.style.bottom]);

    const { canal } = await naReuniaoCom(page, TRES);
    await oChat(page).tap();
    for (let i = 1; i <= 30; i++) canal.mandar(de(CARLOS, `Mensagem ${i}`));
    await expect(mensagens(page)).toHaveCount(30);
    await noFim(page);
    await expect.poll(() => caixa(painel(page))).toEqual({ x: 0, y: 0, width: 390, height: 844 });

    // O teclado sobe: sobram 500 px. O painel fica com eles, com o campo inteiro e a última mensagem acima do teclado.
    await visivel({ height: 500, offsetTop: 0 }, 'resize');
    await expect.poll(() => caixa(painel(page))).toEqual({ x: 0, y: 0, width: 390, height: 500 });
    const c = await caixa(campo(page));
    expect(c.y + c.height).toBeLessThanOrEqual(500);
    await noFim(page);
    const ultima = await caixa(mensagens(page).last());
    expect(ultima.y + ultima.height).toBeLessThanOrEqual(c.y);
    // O navegador rola a janela para mostrar o campo: o painel acompanha a parte visível.
    await visivel({ height: 500, offsetTop: 120 }, 'scroll');
    await expect.poll(() => caixa(painel(page))).toEqual({ x: 0, y: 120, width: 390, height: 500 });
    expect(await medidasNoStyle()).toEqual(['120px', '500px', 'auto']);

    // Com a tela aproximada pelos dedos, o painel não segue a parte visível: ele ficaria pequeno demais.
    await visivel({ height: 250, offsetTop: 60, scale: 2 }, 'resize');
    expect(await medidasNoStyle()).toEqual(['', '', '']);
    await visivel({ height: 500, offsetTop: 0, scale: 1 }, 'resize');
    expect(await medidasNoStyle()).toEqual(['0px', '500px', 'auto']);

    // Fechado o painel, as medidas saem do style.
    await botao(page, 'Voltar para a reunião').tap();
    await expect(painel(page)).toBeHidden();
    expect(await medidasNoStyle()).toEqual(['', '', '']);
    // E o que a parte visível fizer depois não as traz de volta.
    await visivel({ height: 400, offsetTop: 0 }, 'resize');
    expect(await medidasNoStyle()).toEqual(['', '', '']);
  });
});

test.describe('no celular, com o chat fechado', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('no celular, o número fica no canto do botão', async ({ page }) => {
    const { canal } = await naReuniaoCom(page, TRES);
    const antes = await caixa(oChat(page));
    canal.mandar(de(CARLOS, 'Oi'));
    await expect(numero(page)).toHaveText('1');
    // Dentro do botão, em cima, à direita: a 8 px de cima e a 14 px da direita (e o 1 px da borda), com 20 px.
    const b = await caixa(oChat(page));
    const n = await caixa(numero(page));
    expect(n.y - b.y).toBeCloseTo(9, 0);
    expect(b.x + b.width - (n.x + n.width)).toBeCloseTo(15, 0);
    expect([n.width, n.height]).toEqual([20, 20]);
    // Sem cobrir o texto "Chat" (ele fica no canto do desenho, como no quadro), e sem mudar o tamanho do botão.
    const p = await caixa(oChat(page).getByText('Chat', { exact: true }));
    expect(p.x + p.width <= n.x || n.x + n.width <= p.x || p.y + p.height <= n.y || n.y + n.height <= p.y).toBe(true);
    expect(b).toEqual(antes);
    await expect(botao(page, 'Chat, 1 mensagem nova')).toBeVisible();
  });

  test('no celular, o aviso não cobre o Você: fica 8 px acima dele', async ({ page }) => {
    const { a, v, t } = await oAvisoEOVoce(page);
    expect(a.width).toBe(374);
    expect(t.width).toBe(354);
    expect(v.y - (t.y + t.height)).toBeCloseTo(8, 0);
    // O toque no Abrir o chat abre o painel, que cobre a tela.
    await abrirOChat(page).tap();
    await expect(painel(page)).toHaveAttribute('data-modo', 'cobre');
    await expect(tituloDoPainel(page)).toBeFocused();
  });
});

// ---- O celular deitado e o tablet: a tela de toque larga. ----

for (const [nome, viewport] of [
  ['o celular deitado', { width: 844, height: 390 }],
  ['o tablet', { width: 1180, height: 820 }],
] as const) {
  test.describe(nome, () => {
    test.use({ viewport, isMobile: true, hasTouch: true });

    test(`${nome}: o painel cobre a tela`, async ({ page }) => {
      const { canal } = await naReuniaoCom(page, TRES);
      await oChat(page).tap();
      await expect(painel(page)).toHaveAttribute('data-modo', 'cobre');
      await expect.poll(() => caixa(painel(page))).toEqual({ x: 0, y: 0, ...viewport });
      await expect(botao(page, 'Voltar para a reunião')).toBeVisible();
      await expect(botao(page, 'Fechar o chat')).toBeHidden();
      for (const s of FUNDO) await expect(page.locator(s)).toHaveAttribute('inert');
      await expect(tituloDoPainel(page)).toBeFocused();
      // O campo cabe na tela, e a lista tem lugar para as mensagens.
      const c = await caixa(campo(page));
      expect(c.y + c.height).toBeLessThanOrEqual(viewport.height);
      canal.mandar(de(CARLOS, 'Bom dia'));
      await expect(balao(page, 1)).toBeVisible();
      expect((await caixa(lista(page))).height).toBeGreaterThanOrEqual(200);
    });
  });
}
