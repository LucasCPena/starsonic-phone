// A conversa (Task 6), contra o servidor do chat de teste: os balões (os meus à direita, em azul), a hora e o separador
// do dia, o Enter e o Shift+Enter, o limite de 4.000 caracteres com o "Faltam <n>", o "Enviando…", o "Não enviada"
// depois de 15 s e o "Tentar de novo" com o mesmo idLocal, a minha mensagem que volta também pelo WebSocket (Review
// Focus 2), as anteriores de 50 em 50 sem perder o lugar, a mensagem nova que não puxa a tela de quem lê as antigas
// (Review Focus 3), a leitura só com a janela na frente, a leitura em outro computador meu, o Ligar, quem saiu do chat,
// o grupo, os textos compridos sem rolar para o lado (Review Focus 4), o Esc, a página atrasada de outra conversa, a
// mensagem que falha ou chega com a conversa fechada (os Pendentes ficam com a conversa), o Pendente e a página da
// pessoa de antes que nunca aparecem depois da troca de conta (Review Focus 1), o aria-busy de 1 s na entrada de cada
// página, quem mandou cada balão para o leitor de tela e a acessibilidade nos dois temas. Cada teste cria a própria
// empresa.
import { expect, test, type APIResponse, type Page, type Route } from '@playwright/test';
import { capturar, comandos, depoisDoQueChegou, empurrar, esperarComando, mudarEstado, semViolacoesSerias } from '../helpers';
import { abrirAConversa, abrirNoChat, esperarOsEventos, pararORelogio } from './abrir';
import { ApiDeTeste, baseDoChat, empresaComPessoas, ligarComputador, tirarPessoa } from './servidor';

// O CSP da página só deixa falar com o endereço do chat de verdade; o servidor de teste fica no 127.0.0.1:4180.
test.use({ bypassCSP: true });

const EMPRESA = 'ACME Comércio Ltda';
const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
const ANA = { ramal: '2003', nome: 'Ana Souza' };
const JOAO = { ramal: '2004', nome: 'João Pereira' };
/** A segunda conta do cenário chat-duas-contas. */
const CAIXA = { ramal: '2015', nome: 'Caixa 2' };
const ID_DA_CAIXA = '41aa07c3d2e95b18';
const DIA = 86_400_000;

// A hora como a página mostra (o timezoneId do playwright.config.ts).
const hora = (ms: number) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);

const conversaCom = (page: Page, nome: string) => page.getByRole('log', { name: `Mensagens com ${nome}` });
const campoPara = (page: Page, nome: string) => page.getByRole('textbox', { name: `Mensagem para ${nome}` });
const abaChat = (page: Page) => page.getByRole('navigation', { name: 'Seções' }).locator('.tab-chat');
const nomeDoTema = (tema: 'light' | 'dark') => (tema === 'light' ? 'claro' : 'escuro');
/** O endereço do POST das mensagens da conversa (o GET das páginas vem com a busca: não casa com ele). */
const envios = (conversa: number) => `${baseDoChat()}/api/v1/conversas/${conversa}/mensagens`;
/** Um instante da página (um pedido que acabou de chegar já foi tratado). */
const umInstante = (page: Page) => page.evaluate(() => new Promise((r) => setTimeout(r, 200)));

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

/**
 * Review Focus 1: depois que a conversa da primeira pessoa sai da tela (o log some), a cada mudança da página, nenhum
 * balão com um destes textos (o window.__misturas guarda os que aparecerem).
 */
async function vigiarOsBaloes(page: Page, textos: string[]): Promise<void> {
  await page.evaluate((lista) => {
    const w = window as unknown as { __misturas: string[][] };
    w.__misturas = [];
    let saiu = false;
    new MutationObserver(() => {
      if (!document.querySelector('[role="log"]')) saiu = true;
      if (!saiu) return;
      const vistos = [...document.querySelectorAll('.balao-texto')].map((n) => n.textContent ?? '').filter((t) => lista.includes(t));
      if (vistos.length > 0) w.__misturas.push(vistos);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  }, textos);
}

const misturas = (page: Page) => page.evaluate(() => (window as unknown as { __misturas: string[][] }).__misturas);

test('the conversation shows the bubbles with the time and the day, mine on the right', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await ana.api.enviarTexto(dupla, 'Bom dia. Você viu o pedido da ACME?');
  await ana.api.enviarTexto(dupla, 'Pode me mandar a proposta da ACME?');
  await a.api.enviarTexto(dupla, 'Segue a proposta. Qualquer dúvida, me liga.');
  const mensagens = await a.api.mensagens(dupla);
  // A página no dia seguinte: as mensagens de agora são de ontem.
  await page.clock.install({ time: mensagens[0].criadaEm + DIA });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');

  const log = conversaCom(page, 'Ana Souza');
  await expect(log.locator('.balao-texto')).toHaveText([
    'Bom dia. Você viu o pedido da ACME?',
    'Pode me mandar a proposta da ACME?',
    'Segue a proposta. Qualquer dúvida, me liga.',
  ]);
  await expect(log.locator('.conversa-dia')).toHaveText(['Ontem']);
  await expect(log.locator('.balao-hora')).toHaveText(mensagens.map((m) => hora(m.criadaEm)));
  // O cabeçalho: o nome, o ramal e o Ligar; as abas de baixo saem.
  await expect(page.getByRole('heading', { name: 'Ana Souza', level: 1 })).toBeVisible();
  await expect(page.getByText('Ramal 2003', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ligar para Ana Souza, ramal 2003' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Seções' })).toHaveCount(0);

  // As minhas à direita, em blue com o texto branco; as da Ana à esquerda.
  const minha = log.locator('.balao-meu .balao-texto');
  await expect(minha).toHaveText(['Segue a proposta. Qualquer dúvida, me liga.']);
  await expect(minha).toHaveCSS('background-color', 'rgb(12, 38, 113)');
  await expect(minha).toHaveCSS('color', 'rgb(255, 255, 255)');
  const caixa = (await log.boundingBox())!;
  const direita = (await minha.boundingBox())!;
  const esquerda = (await log.locator('.balao-outro .balao-texto').first().boundingBox())!;
  expect(caixa.x + caixa.width - (direita.x + direita.width)).toBeLessThan(24);
  expect(esquerda.x - caixa.x).toBeLessThan(24);
  expect(direita.x).toBeGreaterThan(esquerda.x + 40);
});

test('Enter sends and Shift+Enter breaks the line', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  const textos: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url() === envios(dupla)) textos.push(r.postDataJSON().texto);
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  const campo = campoPara(page, 'Ana Souza');
  await expect(campo).toBeFocused();
  await expect(campo).toHaveAttribute('placeholder', 'Escreva uma mensagem');
  const log = conversaCom(page, 'Ana Souza');

  // Só de espaços (também com uma quebra de linha), nem o Enter nem o Enviar mandam.
  await campo.fill('   \n  ');
  await campo.press('Enter');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(log.locator('.balao')).toHaveCount(0);

  await campo.fill('');
  await campo.pressSequentially('Bom dia');
  await campo.press('Shift+Enter');
  await campo.pressSequentially('Tudo certo por aí?');
  await expect(campo).toHaveValue('Bom dia\nTudo certo por aí?');
  await campo.press('Enter');
  await expect(campo).toHaveValue('');
  const balao = log.locator('.balao-meu .balao-texto');
  await expect(balao).toHaveCount(1);
  // O innerText guarda a quebra só se o balão a mostra.
  expect(await balao.innerText()).toBe('Bom dia\nTudo certo por aí?');
  await expect.poll(async () => (await ana.api.mensagens(dupla)).map((m) => m.texto)).toEqual(['Bom dia\nTudo certo por aí?']);
  expect(textos).toEqual(['Bom dia\nTudo certo por aí?']);
});

test('near the limit it shows how many are left and stops at 4,000', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  await ana.api.criarDupla(a.pessoa.id);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  const campo = campoPara(page, 'Ana Souza');
  const faltam = page.getByText(/^Faltam \d+$/);

  await campo.fill('a'.repeat(3799));
  await expect(faltam).toHaveCount(0);
  await campo.fill('a'.repeat(3800));
  await expect(faltam).toHaveText('Faltam 200');
  await campo.fill('a'.repeat(3850));
  await expect(faltam).toHaveText('Faltam 150');
  await expect(campo).toHaveAccessibleDescription('Faltam 150');

  // Um emoji conta 1 (no UTF-16 são 2): com ele, falta 1.
  await campo.fill('a'.repeat(3998));
  await campo.press('End');
  await page.keyboard.insertText('😀');
  await expect(faltam).toHaveText('Faltam 1');
  // Digitando mais, só a primeira letra cabe.
  await page.keyboard.type('bcd');
  await expect(faltam).toHaveText('Faltam 0');
  const valor = await campo.inputValue();
  expect([...valor]).toHaveLength(4000);
  expect(valor.endsWith('😀b')).toBe(true);
});

test('a sent message shows Enviando… and then the time', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  // O POST fica parado aqui (nem chega ao servidor) até o teste soltar.
  let preso: Route | null = null;
  await page.route(envios(dupla), (rota) => {
    if (rota.request().method() !== 'POST') return rota.continue();
    preso = rota;
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  const campo = campoPara(page, 'Ana Souza');
  await campo.fill('Te mando o contrato em 5 minutos.');
  await campo.press('Enter');

  const minha = conversaCom(page, 'Ana Souza').locator('.balao-meu');
  await expect(minha.locator('.balao-texto')).toHaveText(['Te mando o contrato em 5 minutos.']);
  await expect(minha.locator('.balao-hora')).toHaveText(['Enviando…']);
  await expect.poll(() => preso !== null).toBe(true);
  await preso!.continue();
  await expect.poll(async () => (await a.api.mensagens(dupla)).length).toBe(1);
  const [m] = await a.api.mensagens(dupla);
  await expect(minha.locator('.balao-hora')).toHaveText([hora(m.criadaEm)]);
  await expect(page.getByText('Enviando…')).toHaveCount(0);
});

test('no answer in 15 seconds is Não enviada, and Tentar de novo sends it with the same idLocal', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await page.clock.install();
  // O primeiro POST fica sem resposta (e sem chegar ao servidor); os outros passam.
  const corpos: Array<{ idLocal: string; texto: string }> = [];
  let primeiro: Route | null = null;
  await page.route(envios(dupla), (rota) => {
    if (rota.request().method() !== 'POST') return rota.continue();
    corpos.push(rota.request().postDataJSON());
    if (primeiro === null) {
      primeiro = rota;
      return;
    }
    return rota.continue();
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  // O relógio parado: o prazo de 20 s do primeiro POST nunca passa sozinho, nem numa máquina lenta.
  await pararORelogio(page);
  await abrirAConversa(page, 'Ana Souza');
  const campo = campoPara(page, 'Ana Souza');
  await campo.fill('Te mando o contrato em 5 minutos.');
  await campo.press('Enter');
  const log = conversaCom(page, 'Ana Souza');
  const minha = log.locator('.balao-meu');
  await expect(minha.locator('.balao-hora')).toHaveText(['Enviando…']);
  await expect.poll(() => corpos.length).toBe(1);

  await page.clock.runFor(15_000);
  await expect(minha.getByText('Não enviada', { exact: true })).toBeVisible();
  await expect(minha.locator('.balao-hora')).toHaveCount(0);
  const tentar = minha.getByRole('button', { name: 'Tentar de novo' });
  await tentar.click();
  await expect.poll(() => corpos.length).toBe(2);
  expect(corpos[1]).toEqual(corpos[0]);
  await expect.poll(async () => (await a.api.mensagens(dupla)).length).toBe(1);
  const [m] = await a.api.mensagens(dupla);
  expect(m.idLocal).toBe(corpos[0].idLocal);
  await expect(minha.locator('.balao-hora')).toHaveText([hora(m.criadaEm)]);
  await expect(minha.getByText('Não enviada', { exact: true })).toHaveCount(0);

  // O primeiro chega ao servidor só agora, com o mesmo idLocal: o servidor devolve a mesma mensagem, e continua uma só.
  const chegou = page.waitForResponse((r) => r.request() === primeiro!.request());
  await primeiro!.continue();
  expect((await chegou).status()).toBe(200);
  // Com o relógio parado, o instante é do teste (os timers da página não andam).
  await page.waitForTimeout(200);
  await expect(log.locator('.balao')).toHaveCount(1);
  expect((await a.api.mensagens(dupla)).filter((x) => x.idLocal === corpos[0].idLocal)).toHaveLength(1);
});

test('my message that also comes by the WebSocket shows once', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  // O primeiro POST chega ao servidor (que grava e manda o evento), e a resposta dele espera o teste.
  let segura: { rota: Route; resposta: APIResponse } | null = null;
  await page.route(envios(dupla), async (rota) => {
    if (rota.request().method() !== 'POST' || segura !== null) return rota.continue();
    segura = { rota, resposta: await rota.fetch() };
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  await esperarOsEventos(page);
  const log = conversaCom(page, 'Ana Souza');
  const campo = campoPara(page, 'Ana Souza');
  await campo.fill('Segue a proposta.');
  await campo.press('Enter');
  await expect.poll(() => segura !== null).toBe(true);
  const m = (await segura!.resposta.json()).mensagem;
  // O evento chegou antes da resposta: o balão já é o da mensagem, com a hora.
  await expect(log.locator('.balao-hora')).toHaveText([hora(m.criadaEm)]);
  const chegou = page.waitForResponse((r) => r.request() === segura!.rota.request());
  await segura!.rota.fulfill({ response: segura!.resposta });
  await chegou;
  await umInstante(page);
  await expect(log.locator('.balao')).toHaveCount(1);
  await expect(log.locator('.balao-texto')).toHaveText(['Segue a proposta.']);

  // A segunda passa direto (a resposta e o evento na ordem que vierem): também uma vez só.
  await campo.fill('Qualquer dúvida, me liga.');
  await campo.press('Enter');
  await expect.poll(async () => (await a.api.mensagens(dupla)).length).toBe(2);
  const [, segunda] = await a.api.mensagens(dupla);
  await expect(log.locator('.balao-hora')).toHaveText([hora(m.criadaEm), hora(segunda.criadaEm)]);
  await umInstante(page);
  await expect(log.locator('.balao-texto')).toHaveText(['Segue a proposta.', 'Qualquer dúvida, me liga.']);
});

test('scrolling up brings 50 older at a time and keeps the place', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  // 120 mensagens, uma de cada lado por vez (cada computador manda até 60 por minuto).
  const ids: number[] = [];
  for (let i = 1; i <= 120; i++) ids.push(await (i % 2 === 1 ? ana : a).api.enviarTexto(dupla, `Mensagem ${i}`));
  const antes: number[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname === `/api/v1/conversas/${dupla}/mensagens` && url.searchParams.has('antes')) antes.push(Number(url.searchParams.get('antes')));
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  const log = conversaCom(page, 'Ana Souza');
  const textos = log.locator('.balao-texto');

  // Abre com as 50 mais novas, embaixo.
  await expect(textos).toHaveCount(50);
  await expect(textos.first()).toHaveText('Mensagem 71');
  await expect(log.getByText('Mensagem 120', { exact: true })).toBeInViewport();
  await expect(log.getByText('Mensagem 71', { exact: true })).not.toBeInViewport();

  // No alto, mais 50 (antes da mais antiga na tela), e a que estava no alto continua à vista.
  await log.evaluate((el) => (el.scrollTop = 0));
  await expect(textos).toHaveCount(100);
  await expect(textos.first()).toHaveText('Mensagem 21');
  await expect(log.getByText('Mensagem 71', { exact: true })).toBeInViewport();
  await expect(log.getByText('Mensagem 21', { exact: true })).not.toBeInViewport();
  await log.evaluate((el) => (el.scrollTop = 0));
  await expect(textos).toHaveCount(120);
  await expect(textos.first()).toHaveText('Mensagem 1');
  await expect(log.getByText('Mensagem 21', { exact: true })).toBeInViewport();
  expect(antes).toEqual([ids[70], ids[20]]);
  await expect(textos).toHaveText(Array.from({ length: 120 }, (_, i) => `Mensagem ${i + 1}`));
});

test('a new message does not pull the screen down while reading older ones, and follows at the bottom', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  for (let i = 1; i <= 40; i++) await ana.api.enviarTexto(dupla, `Mensagem ${i}`);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  const log = conversaCom(page, 'Ana Souza');
  const textos = log.locator('.balao-texto');
  await expect(textos).toHaveCount(40);
  await esperarOsEventos(page);
  const doFim = () => log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);

  // Lendo lá em cima: a nova entra embaixo, e a tela fica onde está.
  await log.evaluate((el) => (el.scrollTop = 0));
  await ana.api.enviarTexto(dupla, 'Chegou enquanto eu lia.');
  await expect(textos).toHaveCount(41);
  await umInstante(page);
  expect(await log.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(log.getByText('Mensagem 1', { exact: true })).toBeInViewport();
  await expect(log.getByText('Chegou enquanto eu lia.', { exact: true })).not.toBeInViewport();

  // A 60 px do fim (até 80 vale): a tela acompanha.
  await log.evaluate((el) => (el.scrollTop = el.scrollHeight - el.clientHeight - 60));
  await ana.api.enviarTexto(dupla, 'Chegou perto do fim.');
  await expect(log.getByText('Chegou perto do fim.', { exact: true })).toBeInViewport();
  await expect.poll(doFim).toBeLessThan(2);

  // Embaixo: a nova fica à vista.
  await ana.api.enviarTexto(dupla, 'Chegou com a tela embaixo.');
  await expect(log.getByText('Chegou com a tela embaixo.', { exact: true })).toBeInViewport();
  await expect.poll(doFim).toBeLessThan(2);
});

test('the open conversation marks as read only with the window in front', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  const bomDia = await ana.api.enviarTexto(dupla, 'Bom dia!');
  const lidas: number[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url() === `${baseDoChat()}/api/v1/conversas/${dupla}/lida`) lidas.push(r.postDataJSON().ate);
  });
  const numeros = async () => (await comandos(page)).filter((c) => c.cmd === 'chatBadge').map((c) => c.n);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await expect(abaChat(page)).toHaveAccessibleName('Chat, 1 mensagem não lida');
  // Aberta com a janela na frente (o `janela` da ponte falsa depois do ready): lida na hora.
  await abrirAConversa(page, 'Ana Souza');
  await expect.poll(() => lidas).toEqual([bomDia]);
  await expect.poll(numeros).toEqual([1, 0]);
  await esperarOsEventos(page);

  // A janela fora da frente: a mensagem da Ana chega, fica não lida, e vem o aviso.
  await empurrar(page, { v: 1, type: 'janela', frente: false });
  await depoisDoQueChegou(page);
  const proposta = await ana.api.enviarTexto(dupla, 'Pode me mandar a proposta da ACME?');
  const log = conversaCom(page, 'Ana Souza');
  await expect(log.locator('.balao-texto').last()).toHaveText('Pode me mandar a proposta da ACME?');
  await esperarComando(page, { cmd: 'chatNotify', conversa: dupla, titulo: 'Ana Souza', texto: 'Pode me mandar a proposta da ACME?' });
  await expect.poll(numeros).toEqual([1, 0, 1]);
  expect(lidas).toEqual([bomDia]);

  // Na frente de novo: a leitura até ela, e o número a 0.
  await empurrar(page, { v: 1, type: 'janela', frente: true });
  await expect.poll(() => lidas).toEqual([bomDia, proposta]);
  await expect.poll(numeros).toEqual([1, 0, 1, 0]);
  // Fora e na frente de novo, sem mensagem nova: o mesmo id não vai outra vez.
  await empurrar(page, { v: 1, type: 'janela', frente: false });
  await empurrar(page, { v: 1, type: 'janela', frente: true });
  await depoisDoQueChegou(page);
  expect(lidas).toEqual([bomDia, proposta]);
});

test('reading on another computer of mine clears the count here', async ({ page }) => {
  const { codigo, pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await ana.api.enviarTexto(dupla, 'Bom dia!');
  const ultima = await ana.api.enviarTexto(dupla, 'Pode me mandar a proposta da ACME?');
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await expect(abaChat(page)).toHaveAccessibleName('Chat, 2 mensagens não lidas');
  await esperarOsEventos(page);

  // A mesma pessoa lê no outro computador dela: o evento lida zera o número aqui.
  const outro = await ligarComputador(codigo, 'RECEPCAO-02');
  const meuOutro = new ApiDeTeste(outro.chave);
  await meuOutro.entrar(RECEPCAO.ramal, RECEPCAO.nome);
  await meuOutro.marcarLida(dupla, ultima);
  await expect(abaChat(page)).toHaveAccessibleName('Chat');
  await expect(page.locator('.chat-linha .chat-numero')).toHaveCount(0);
  await expect.poll(async () => (await comandos(page)).filter((c) => c.cmd === 'chatBadge').map((c) => c.n)).toEqual([2, 0]);
});

test('Ligar calls the ramal like a contact', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await ana.api.enviarTexto(dupla, 'Me liga quando puder.');
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  await page.getByRole('button', { name: 'Ligar para Ana Souza, ramal 2003' }).click();
  await esperarComando(page, { cmd: 'dial', numero: '2003', contato: true });
});

test('a conversation with someone who left shows (saiu) and no field', async ({ page }) => {
  const { empresaId, pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await ana.api.enviarTexto(dupla, 'Hoje é o meu último dia. Obrigada por tudo!');
  await tirarPessoa(empresaId, ana.pessoa.id);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza (saiu)');

  await expect(page.getByRole('heading', { name: 'Ana Souza (saiu)', level: 1 })).toBeVisible();
  await expect(conversaCom(page, 'Ana Souza (saiu)').locator('.balao-texto')).toHaveText(['Hoje é o meu último dia. Obrigada por tudo!']);
  await expect(page.getByText('Ana Souza saiu do chat.', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enviar' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Ligar para/ })).toHaveCount(0);
});

test("group bubbles show the author's name and the notices in the middle", async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO]);
  const [a, ana, joao] = pessoas;
  const comercial = await joao.api.criarGrupo('Comercial', [a.pessoa.id, ana.pessoa.id]);
  await joao.api.enviarTexto(comercial, 'Bom dia, pessoal. O pedido da ACME saiu?');
  await ana.api.enviarTexto(comercial, 'Saiu ontem à tarde.');
  await a.api.enviarTexto(comercial, 'Confirmei com o cliente agora.');
  await joao.api.enviarTexto(comercial, 'Fechamos o pedido de hoje.');
  // Os avisos do servidor (o criou e um pos para cada pessoa posta), como a lista os escreve: eu sou "você".
  const avisos = (await a.api.mensagens(comercial))
    .filter((m) => m.tipo === 'aviso')
    .map((m) =>
      m.aviso.acao === 'criou'
        ? `${m.aviso.quem.nome} criou o grupo`
        : `${m.aviso.quem.nome} pôs ${m.aviso.alvo.id === a.pessoa.id ? 'você' : m.aviso.alvo.nome} no grupo`,
    );
  expect(avisos).toHaveLength(3);
  expect(avisos).toContain('João Pereira criou o grupo');
  expect(avisos).toContain('João Pereira pôs você no grupo');
  expect(avisos).toContain('João Pereira pôs Ana Souza no grupo');

  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Comercial');
  const log = page.getByRole('log', { name: 'Mensagens do grupo Comercial' });
  await expect(log.locator('.conversa-aviso')).toHaveText(avisos);
  await expect(log.locator('.balao-texto')).toHaveText([
    'Bom dia, pessoal. O pedido da ACME saiu?',
    'Saiu ontem à tarde.',
    'Confirmei com o cliente agora.',
    'Fechamos o pedido de hoje.',
  ]);
  // O nome de quem mandou em cima do balão dos outros; o meu, sem nome.
  await expect(log.locator('.balao-outro .balao-autor')).toHaveText(['João Pereira', 'Ana Souza', 'João Pereira']);
  await expect(log.locator('.balao-meu .balao-autor')).toHaveCount(0);
  // Para o leitor de tela, o meu diz "Você"; os dos outros já têm o nome à vista.
  await expect(log.locator('.balao-meu .sr-only')).toHaveText(['Você']);
  await expect(log.locator('.balao-outro .sr-only')).toHaveCount(0);
  // Os avisos no meio da conversa.
  const caixa = (await log.boundingBox())!;
  for (const aviso of await log.locator('.conversa-aviso').all()) {
    const b = (await aviso.boundingBox())!;
    expect(Math.abs(b.x + b.width / 2 - (caixa.x + caixa.width / 2))).toBeLessThan(6);
  }

  // O cabeçalho do grupo: o nome e "3 pessoas · ver os membros", sem o Ligar.
  const membros = page.getByRole('button', { name: 'Ver os membros do grupo Comercial' });
  await expect(membros).toContainText('Comercial');
  await expect(membros).toContainText('3 pessoas · ver os membros');
  await expect(page.getByRole('heading', { name: 'Comercial', level: 1 })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Ligar para/ })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Mensagem para o grupo Comercial' })).toHaveAttribute('placeholder', 'Escreva para o grupo');
});

test('a 4,000-character word and a 60-character group name never scroll the window sideways', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, JOAO]);
  const [a, joao] = pessoas;
  const nome = 'ComercialDaACME'.repeat(4);
  const palavra = 'Proposta'.repeat(500);
  expect([...nome]).toHaveLength(60);
  expect([...palavra]).toHaveLength(4000);
  const grupo = await joao.api.criarGrupo(nome, [a.pessoa.id]);
  await joao.api.enviarTexto(grupo, palavra);
  await a.api.enviarTexto(grupo, palavra);

  for (const largura of [400, 300]) {
    await page.setViewportSize({ width: largura, height: 720 });
    await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
    await abrirAConversa(page, nome);
    const log = page.getByRole('log', { name: `Mensagens do grupo ${nome}` });
    await expect(log.locator('.balao-texto')).toHaveText([palavra, palavra]);
    await page.getByRole('textbox', { name: `Mensagem para o grupo ${nome}` }).fill(palavra);
    const medidas = await page.evaluate(() => {
      const log = document.querySelector('[role="log"]')!;
      return {
        janela: document.documentElement.scrollWidth,
        direita: Math.max(...[...document.querySelectorAll('.win *')].map((e) => e.getBoundingClientRect().right)),
        esquerda: Math.min(...[...document.querySelectorAll('.win *')].map((e) => e.getBoundingClientRect().left)),
        log: log.scrollWidth - log.clientWidth,
      };
    });
    expect(medidas.janela, `${largura} px`).toBeLessThanOrEqual(largura);
    expect(medidas.direita, `${largura} px`).toBeLessThanOrEqual(largura + 0.5);
    expect(medidas.esquerda, `${largura} px`).toBeGreaterThanOrEqual(-0.5);
    expect(medidas.log, `${largura} px`).toBeLessThanOrEqual(0);
  }
});

test('Esc goes back to the list', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await ana.api.enviarTexto(dupla, 'Bom dia!');
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  await expect(conversaCom(page, 'Ana Souza')).toBeVisible();
  await expect(campoPara(page, 'Ana Souza')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(conversaCom(page, 'Ana Souza')).toHaveCount(0);
  await expect(page.getByRole('main', { name: 'Chat' })).toBeVisible();
  await expect(page.locator('.chat-linha')).toHaveCount(1);
  // O Voltar também volta para a lista.
  await abrirAConversa(page, 'Ana Souza');
  await page.getByRole('button', { name: 'Voltar para as conversas' }).click();
  await expect(page.getByRole('main', { name: 'Chat' })).toBeVisible();
  await expect(conversaCom(page, 'Ana Souza')).toHaveCount(0);
});

test('a page that arrives after going to another conversation never shows there', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO]);
  const [a, ana, joao] = pessoas;
  const comAna = await ana.api.criarDupla(a.pessoa.id);
  await ana.api.enviarTexto(comAna, 'Pode me mandar a proposta da ACME?');
  const comJoao = await joao.api.criarDupla(a.pessoa.id);
  await joao.api.enviarTexto(comJoao, 'Fechamos o pedido de hoje.');
  // A primeira página da conversa com a Ana vem do servidor, mas só chega à página depois que a do João abriu.
  let presa: { rota: Route; resposta: APIResponse } | null = null;
  await page.route(
    (url) => url.pathname === `/api/v1/conversas/${comAna}/mensagens`,
    async (rota) => {
      if (presa !== null || rota.request().method() !== 'GET') return rota.continue();
      presa = { rota, resposta: await rota.fetch() };
    },
  );
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  await expect.poll(() => presa !== null).toBe(true);
  await page.getByRole('button', { name: 'Voltar para as conversas' }).click();
  await abrirAConversa(page, 'João Pereira');
  const log = conversaCom(page, 'João Pereira');
  await expect(log.locator('.balao-texto')).toHaveText(['Fechamos o pedido de hoje.']);

  const chegou = page.waitForResponse((r) => r.request() === presa!.rota.request());
  await presa!.rota.fulfill({ response: presa!.resposta });
  await chegou;
  await umInstante(page);
  await expect(log.locator('.balao-texto')).toHaveText(['Fechamos o pedido de hoje.']);
});

test('a message that fails while its conversation is closed shows Não enviada when it opens again', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await ana.api.enviarTexto(dupla, 'Bom dia!');
  await page.clock.install();
  // O primeiro POST fica sem resposta (e sem chegar ao servidor); os outros passam.
  const corpos: Array<{ idLocal: string; texto: string }> = [];
  let primeiro: Route | null = null;
  await page.route(envios(dupla), (rota) => {
    if (rota.request().method() !== 'POST') return rota.continue();
    corpos.push(rota.request().postDataJSON());
    if (primeiro === null) {
      primeiro = rota;
      return;
    }
    return rota.continue();
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await pararORelogio(page);
  await abrirAConversa(page, 'Ana Souza');
  const log = conversaCom(page, 'Ana Souza');
  await expect(log.locator('.balao-texto')).toHaveText(['Bom dia!']);
  await campoPara(page, 'Ana Souza').fill('Te mando o contrato em 5 minutos.');
  await campoPara(page, 'Ana Souza').press('Enter');
  await expect(log.locator('.balao-meu .balao-hora')).toHaveText(['Enviando…']);
  await expect.poll(() => corpos.length).toBe(1);

  // A pessoa sai da conversa com a mensagem a caminho, e os 15 s passam com ela fechada.
  await page.keyboard.press('Escape');
  await expect(log).toHaveCount(0);
  await page.clock.runFor(15_000);
  await abrirAConversa(page, 'Ana Souza');
  const minha = log.locator('.balao-meu');
  await expect(minha.locator('.balao-texto')).toHaveText(['Te mando o contrato em 5 minutos.']);
  await expect(minha.getByText('Não enviada', { exact: true })).toBeVisible();
  await minha.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect.poll(() => corpos.length).toBe(2);
  expect(corpos[1]).toEqual(corpos[0]);
  await expect.poll(async () => (await a.api.mensagens(dupla)).filter((m) => m.idLocal === corpos[0].idLocal).length).toBe(1);
  const m = (await a.api.mensagens(dupla)).find((x) => x.idLocal === corpos[0].idLocal);
  await expect(minha.locator('.balao-hora')).toHaveText([hora(m.criadaEm)]);
  await expect(minha.getByText('Não enviada', { exact: true })).toHaveCount(0);
  await primeiro!.abort();
});

test('a message answered while its conversation is closed shows once when it opens again', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await ana.api.enviarTexto(dupla, 'Bom dia!');
  let preso: Route | null = null;
  await page.route(envios(dupla), (rota) => {
    if (rota.request().method() !== 'POST') return rota.continue();
    preso = rota;
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  const log = conversaCom(page, 'Ana Souza');
  await expect(log.locator('.balao-texto')).toHaveText(['Bom dia!']);
  await campoPara(page, 'Ana Souza').fill('Segue a proposta.');
  await campoPara(page, 'Ana Souza').press('Enter');
  await expect.poll(() => preso !== null).toBe(true);

  // Fechada, a resposta chega: a mensagem fica na lista, e o Pendente sai.
  await page.keyboard.press('Escape');
  await expect(log).toHaveCount(0);
  const chegou = page.waitForResponse((r) => r.request() === preso!.request());
  await preso!.continue();
  expect((await chegou).status()).toBe(201);
  await expect(page.locator('.chat-linha .chat-previa')).toHaveText(['Você: Segue a proposta.']);
  await abrirAConversa(page, 'Ana Souza');
  const [, m] = await a.api.mensagens(dupla);
  await expect(log.locator('.balao-texto')).toHaveText(['Bom dia!', 'Segue a proposta.']);
  await expect(log.locator('.balao-meu .balao-hora')).toHaveText([hora(m.criadaEm)]);
  await umInstante(page);
  await expect(log.locator('.balao')).toHaveCount(2);
  await expect(log.getByText('Enviando…')).toHaveCount(0);
  await expect(log.getByText('Não enviada', { exact: true })).toHaveCount(0);
});

test('a message of the first person still on its way never shows for the second', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, CAIXA]);
  const [a, caixa] = pessoas;
  // A conversa das duas contas do mesmo computador: o mesmo id para as duas pessoas.
  const dupla = await caixa.api.criarDupla(a.pessoa.id);
  await caixa.api.enviarTexto(dupla, 'Oi, Recepção!');
  // O POST da Recepção fica parado (nem chega ao servidor).
  let preso: Route | null = null;
  await page.route(envios(dupla), (rota) => {
    if (rota.request().method() !== 'POST') return rota.continue();
    preso = rota;
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO, cenario: 'chat-duas-contas' });
  await abrirAConversa(page, 'Caixa 2');
  await campoPara(page, 'Caixa 2').fill('Mensagem da Recepção.');
  await campoPara(page, 'Caixa 2').press('Enter');
  await expect(conversaCom(page, 'Caixa 2').locator('.balao-meu .balao-hora')).toHaveText(['Enviando…']);
  await expect.poll(() => preso !== null).toBe(true);
  await vigiarOsBaloes(page, ['Mensagem da Recepção.']);

  await trocarParaACaixaPeloNucleo(page);
  await expect(page.locator('.account-name')).toHaveText('Caixa 2 · 2015');
  await expect(page.getByRole('main', { name: 'Chat' })).toBeVisible();
  // A mesma conversa, agora da Caixa 2: sem o Pendente da Recepção.
  await abrirAConversa(page, 'Recepção');
  const log = conversaCom(page, 'Recepção');
  await expect(log.locator('.balao-texto')).toHaveText(['Oi, Recepção!']);
  await umInstante(page);
  await expect(log.locator('.balao')).toHaveCount(1);
  expect(await misturas(page)).toEqual([]);
  await preso!.abort();
});

test('switching the account with a conversation open leaves it, and a late older page paints nothing', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, CAIXA, ANA, JOAO]);
  const [a, caixa, ana, joao] = pessoas;
  const comA = await ana.api.criarDupla(a.pessoa.id);
  const textos = Array.from({ length: 60 }, (_, i) => `Mensagem ${i + 1}`);
  for (const texto of textos) await ana.api.enviarTexto(comA, texto);
  const comCaixa = await joao.api.criarDupla(caixa.pessoa.id);
  await joao.api.enviarTexto(comCaixa, 'Fechamos o pedido de hoje.');
  // A página anterior vem do servidor ainda como a Recepção, e só chega à página depois da troca.
  let presa: { rota: Route; resposta: APIResponse } | null = null;
  await page.route(
    (url) => url.pathname === `/api/v1/conversas/${comA}/mensagens` && url.searchParams.has('antes'),
    async (rota) => {
      presa = { rota, resposta: await rota.fetch() };
    },
  );
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO, cenario: 'chat-duas-contas' });
  await abrirAConversa(page, 'Ana Souza');
  const log = conversaCom(page, 'Ana Souza');
  await expect(log.locator('.balao-texto')).toHaveCount(50);
  await log.evaluate((el) => (el.scrollTop = 0));
  await expect.poll(() => presa !== null).toBe(true);
  await vigiarOsBaloes(page, textos);

  await trocarParaACaixaPeloNucleo(page);
  // A conversa sai: a aba Chat, com a lista da Caixa 2.
  await expect(page.locator('.account-name')).toHaveText('Caixa 2 · 2015');
  await expect(page.getByRole('main', { name: 'Chat' })).toBeVisible();
  await expect(page.locator('.chat-linha .chat-nome')).toHaveText(['João Pereira']);
  // A página da Recepção chega agora: nada dela aparece.
  const chegou = page.waitForResponse((r) => r.request() === presa!.rota.request());
  await presa!.rota.fulfill({ response: presa!.resposta });
  await chegou;
  await umInstante(page);
  await abrirAConversa(page, 'João Pereira');
  await expect(conversaCom(page, 'João Pereira').locator('.balao-texto')).toHaveText(['Fechamos o pedido de hoje.']);
  expect(await misturas(page)).toEqual([]);
});

test('the log is busy for 1 second from the render that puts a page of 50 in', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  for (let i = 1; i <= 60; i++) await ana.api.enviarTexto(dupla, `Mensagem ${i}`);
  await page.clock.install();
  // A primeira página e a anterior vêm do servidor e esperam o teste.
  const presas: Array<{ rota: Route; resposta: APIResponse }> = [];
  await page.route(
    (url) => url.pathname === `/api/v1/conversas/${dupla}/mensagens` && !url.searchParams.has('depois'),
    async (rota) => {
      if (rota.request().method() !== 'GET') return rota.continue();
      presas.push({ rota, resposta: await rota.fetch() });
    },
  );
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await pararORelogio(page);
  await abrirAConversa(page, 'Ana Souza');
  const log = conversaCom(page, 'Ana Souza');
  // Enquanto a página espera a rede, o log não fica ocupado.
  await expect.poll(() => presas.length).toBe(1);
  await expect(log).toHaveAttribute('aria-busy', 'false');
  // Ela entra com o log ocupado, e ele fica assim por 1 s.
  await presas[0].rota.fulfill({ response: presas[0].resposta });
  await expect(log.locator('.balao-texto')).toHaveCount(50);
  await expect(log).toHaveAttribute('aria-busy', 'true');
  await page.clock.runFor(999);
  await expect(log).toHaveAttribute('aria-busy', 'true');
  await page.clock.runFor(1);
  await expect(log).toHaveAttribute('aria-busy', 'false');

  // As 50 anteriores, do mesmo jeito.
  await log.evaluate((el) => (el.scrollTop = 0));
  await expect.poll(() => presas.length).toBe(2);
  await expect(log).toHaveAttribute('aria-busy', 'false');
  await presas[1].rota.fulfill({ response: presas[1].resposta });
  await expect(log.locator('.balao-texto')).toHaveCount(60);
  await expect(log).toHaveAttribute('aria-busy', 'true');
  await page.clock.runFor(1000);
  await expect(log).toHaveAttribute('aria-busy', 'false');
});

test('in a dupla each bubble tells screen readers who wrote it', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await ana.api.enviarTexto(dupla, 'Pode me mandar a proposta da ACME?');
  await a.api.enviarTexto(dupla, 'Segue a proposta.');
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  const log = conversaCom(page, 'Ana Souza');
  await expect(log.locator('.balao-texto')).toHaveCount(2);
  // Escondido na tela (sem texto visível novo), lido antes do texto do balão.
  await expect(log.locator('.balao-outro .sr-only')).toHaveText(['Ana Souza']);
  await expect(log.locator('.balao-meu .sr-only')).toHaveText(['Você']);
  await expect(log.locator('.balao-autor')).toHaveCount(0);
  await expect(log.locator('.balao-outro')).toHaveText(/^Ana SouzaPode me mandar/);
  // O Pendente também é meu.
  await page.route(envios(dupla), (rota) => (rota.request().method() === 'POST' ? undefined : rota.continue()));
  await campoPara(page, 'Ana Souza').fill('Qualquer dúvida, me liga.');
  await campoPara(page, 'Ana Souza').press('Enter');
  await expect(log.locator('.balao-meu .sr-only')).toHaveText(['Você', 'Você']);
});

for (const tema of ['light', 'dark'] as const) {
  test.describe(`a conversa (${tema})`, () => {
    test.use({ colorScheme: tema });

    test('the conversation has no serious accessibility violations', async ({ page }) => {
      const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO]);
      const [a, ana, joao] = pessoas;
      const dupla = await ana.api.criarDupla(a.pessoa.id);
      await ana.api.enviarTexto(dupla, 'Bom dia. Você viu o pedido da ACME?');
      await ana.api.enviarTexto(dupla, 'Pode me mandar a proposta da ACME?');
      await a.api.enviarTexto(dupla, 'Segue a proposta. Qualquer dúvida, me liga.');
      const comercial = await joao.api.criarGrupo('Comercial', [a.pessoa.id, ana.pessoa.id]);
      await joao.api.enviarTexto(comercial, 'Bom dia, pessoal. O pedido da ACME saiu?');
      await ana.api.enviarTexto(comercial, 'Saiu ontem à tarde.');
      await a.api.enviarTexto(comercial, 'Confirmei com o cliente agora.');
      // Um envio que não sai: o "Não enviada" com o "Tentar de novo" também passa pelo axe.
      await page.route(envios(dupla), (rota) => (rota.request().method() === 'POST' ? rota.abort() : rota.continue()));

      await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
      await abrirAConversa(page, 'Ana Souza');
      const campo = campoPara(page, 'Ana Souza');
      await campo.fill('Te mando o contrato em 5 minutos.');
      await campo.press('Enter');
      await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
      await campo.fill('Falta só o contrato.');
      // As minhas em blue no claro e em cyan no escuro, com o texto on-cyan.
      const minha = conversaCom(page, 'Ana Souza').locator('.balao-meu .balao-texto').first();
      await expect(minha).toHaveCSS('background-color', tema === 'light' ? 'rgb(12, 38, 113)' : 'rgb(0, 194, 203)');
      await expect(minha).toHaveCSS('color', tema === 'light' ? 'rgb(255, 255, 255)' : 'rgb(3, 34, 42)');
      await semViolacoesSerias(page);
      await capturar(page, 'chat-conversa', nomeDoTema(tema));

      await page.getByRole('button', { name: 'Voltar para as conversas' }).click();
      await abrirAConversa(page, 'Comercial');
      await expect(page.getByRole('log', { name: 'Mensagens do grupo Comercial' }).locator('.balao-texto')).toHaveCount(3);
      await semViolacoesSerias(page);
      await capturar(page, 'chat-grupo', nomeDoTema(tema));
    });
  });
}
