// As fotos para a aprovação do responsável (Task 8): cada tela do chat nos dois temas e nos três tamanhos da janela
// (400×720, o Normal; 360×600, o Compacto; e 300×440, o Mínimo), em test-results/capturas/, com o nome
// chat-<tela>-<largura>x<altura>-<tema>.png (o CI publica a pasta no artefato capturas-interface). Cada tela também passa
// pelo axe e pelo teclado: o Tab chega a todo botão (e a todo campo) e volta ao começo, e cada parada dele fica à vista
// (nenhum foco some). As telas sem quadro (R42, a carry da Task 7) ficam nas fotos: a `anexos` tem os anexos em cima do
// campo e um balão subindo com a barra de progresso; a `conversa`, um balão de arquivo, um de foto com a miniatura e um
// "Arquivo expirado"; a `foto-grande`, a foto grande. São testes de verificação (o código já existe). Cada teste cria a
// própria empresa.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { capturar, entrarNaAdmin, semViolacoesSerias } from '../helpers';
import { conferirOTeclado } from '../teclado';
import { abrirAConversa, abrirNoChat, esperarOsEventos } from './abrir';
import { arrastar, imagemDaPagina } from './anexar';
import { ApiDeTeste, baseDoChat, empresaComPessoas, ligarComputador } from './servidor';

// O CSP da página só deixa falar com o endereço do chat de verdade; o servidor de teste fica no 127.0.0.1:4180.
test.use({ bypassCSP: true });

const EMPRESA = 'ACME Comércio Ltda';
const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
const ANA = { ramal: '2003', nome: 'Ana Souza' };
const BEATRIZ = { ramal: '3004', nome: 'Beatriz Ramos' };
const CARLOS = { ramal: '2011', nome: 'Carlos Lima' };
const JOAO = { ramal: '3002', nome: 'João Pereira' };
const JORDANA = { ramal: '3005', nome: 'Jordana Alves' };
const MARCOS = { ramal: '2015', nome: 'Marcos Teixeira' };
const PDF = 'application/pdf';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Um PNG de 1×1 (o servidor trata image/png como foto). */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const DIA = 86_400_000;
const HORA = 3_600_000;
/** O fuso da página (o timezoneId do playwright.config.ts). */
const FUSO = 'America/Sao_Paulo';
const DIAS_DA_SEMANA: Record<string, string> = { Sun: 'Dom', Mon: 'Seg', Tue: 'Ter', Wed: 'Qua', Thu: 'Qui', Fri: 'Sex', Sat: 'Sáb' };

/** O dia, o mês, o ano e o dia da semana ("Seg", como a lista) de um instante, no fuso da página. */
function partesDaData(ms: number): { dia: string; mes: string; ano: string; semana: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric', weekday: 'short' })
      .formatToParts(ms)
      .map((x) => [x.type, x.value]),
  );
  return { dia: p.day, mes: p.month, ano: p.year, semana: DIAS_DA_SEMANA[p.weekday] };
}

/**
 * As 10 h de `dias` dias atrás, no horário de Brasília (sem horário de verão desde 2019: a meia-noite de lá é às 3 h do
 * UTC). Longe da meia-noite, o dia da lista não muda no meio do teste.
 */
function asDezHorasDe(dias: number): number {
  const hoje = partesDaData(Date.now());
  return Date.UTC(Number(hoje.ano), Number(hoje.mes) - 1, Number(hoje.dia), 3) - dias * DIA + 10 * HORA;
}

/** O endereço do POST das mensagens da conversa (o GET das páginas vem com a busca: não casa com ele). */
const envios = (conversa: number) => `${baseDoChat()}/api/v1/conversas/${conversa}/mensagens`;

const TAMANHOS: Array<[number, number]> = [
  [400, 720],
  [360, 600],
  [300, 440],
];
const TEMAS = [
  ['light', 'claro'],
  ['dark', 'escuro'],
] as const;

const conversaCom = (page: Page, nome: string) => page.getByRole('log', { name: `Mensagens com ${nome}` });
const campoPara = (page: Page, nome: string) => page.getByRole('textbox', { name: `Mensagem para ${nome}` });
const botaoEnviar = (page: Page) => page.getByRole('button', { name: 'Enviar', exact: true });

/** Da aba Chat para a Nova conversa ou o Novo grupo, pelo "+". */
async function peloMais(page: Page, item: 'Nova conversa' | 'Novo grupo'): Promise<void> {
  await page.getByRole('button', { name: 'Nova conversa ou novo grupo' }).click();
  await page.getByRole('menuitem', { name: item }).click();
  await expect(page.getByRole('heading', { name: item, level: 1 })).toBeVisible();
}

/** A foto já está à vista: a miniatura (ou a foto grande) aberta, com a medida dela. */
async function imagemAberta(img: Locator): Promise<void> {
  await expect(img).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0))).toBeGreaterThan(0);
}

// --- As telas --------------------------------------------------------------------------------------------------------

interface Tela {
  nome: string;
  /** Monta a tela, pronta para a foto. */
  preparar(page: Page, janela: { largura: number; altura: number }): Promise<void>;
  /** Logo antes da foto (depois do axe): o que precisa estar assim na hora dela (a barra do upload no meio). */
  antesDaFoto?(page: Page): Promise<void>;
  /** Depois da foto e antes do teclado (o campo do código com um código: o "Ligar ao chat" ligado). */
  antesDoTeclado?(page: Page): Promise<void>;
}

const TELAS: Tela[] = [
  {
    // O quadro Main: a mais nova em cima, com as iniciais ou o ícone do grupo, a prévia (a minha com "Você:", a do
    // grupo com o primeiro nome, a foto como "Foto", o arquivo pelo nome e o aviso de grupo pelo texto), a hora e as
    // não lidas. As quatro de baixo são de antes (R49: o GET das conversas com a hora delas recuada, como o servidor a
    // mandaria): de ontem, de três dias atrás, de dez dias atrás e de um ano atrás, e a hora da lista mostra "Ontem", o
    // dia da semana, o "dd/mm" e o "dd/mm/aaaa" (as três primeiras ficam à vista na janela de 400×720).
    nome: 'lista',
    async preparar(page) {
      const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO, BEATRIZ, CARLOS]);
      const [eu, ana, joao, beatriz, carlos] = pessoas;
      const comCarlos = await carlos.api.criarDupla(eu.pessoa.id);
      await eu.api.marcarLida(comCarlos, await carlos.api.enviarArquivo(comCarlos, Buffer.alloc(49_152, 1), 'Pedido 4471.xlsx', XLSX));
      const comJoao = await eu.api.criarDupla(joao.pessoa.id);
      await eu.api.enviarTexto(comJoao, 'Combinado, te ligo depois.');
      const financeiro = await beatriz.api.criarGrupo('Financeiro', [eu.pessoa.id]);
      const comercial = await joao.api.criarGrupo('Comercial', [eu.pessoa.id, ana.pessoa.id]);
      await joao.api.enviarTexto(comercial, 'Fechamos o pedido da ACME.');
      const comBeatriz = await beatriz.api.criarDupla(eu.pessoa.id);
      await beatriz.api.enviarArquivo(comBeatriz, PNG, 'Vitrine da loja.png', 'image/png');
      const comAna = await ana.api.criarDupla(eu.pessoa.id);
      await ana.api.enviarTexto(comAna, 'Bom dia!');
      await ana.api.enviarTexto(comAna, 'Pode me mandar a proposta da ACME?');
      const recuos = new Map([
        [comercial, asDezHorasDe(1)],
        [financeiro, asDezHorasDe(3)],
        [comJoao, asDezHorasDe(10)],
        [comCarlos, asDezHorasDe(400)],
      ]);
      await page.route(`${baseDoChat()}/api/v1/conversas`, async (rota) => {
        if (rota.request().method() !== 'GET') return rota.continue();
        const resposta = await rota.fetch();
        const json = await resposta.json();
        for (const c of json.conversas) c.atualizadaEm = recuos.get(c.id) ?? c.atualizadaEm;
        return rota.fulfill({ response: resposta, json });
      });
      await abrirNoChat(page, { chave: eu.chave, ...RECEPCAO });
      const linhas = page.locator('.chat-linha');
      await expect(linhas.locator('.chat-nome')).toHaveText(['Ana Souza', 'Beatriz Ramos', 'Comercial', 'Financeiro', 'João Pereira', 'Carlos Lima']);
      await expect(linhas.locator('.chat-previa')).toHaveText([
        'Pode me mandar a proposta da ACME?',
        'Foto',
        'João: Fechamos o pedido da ACME.',
        'Beatriz Ramos pôs você no grupo',
        'Você: Combinado, te ligo depois.',
        'Pedido 4471.xlsx',
      ]);
      // A hora como a lista a escreve (formato.ts, horaDaLista): "dd/mm", ou "dd/mm/aaaa" de outro ano.
      const hoje = partesDaData(Date.now());
      const diaMes = (ms: number) => {
        const d = partesDaData(ms);
        return d.ano === hoje.ano ? `${d.dia}/${d.mes}` : `${d.dia}/${d.mes}/${d.ano}`;
      };
      await expect(linhas.locator('.chat-hora')).toHaveText([
        /^\d\d:\d\d$/,
        /^\d\d:\d\d$/,
        'Ontem',
        partesDaData(asDezHorasDe(3)).semana,
        diaMes(asDezHorasDe(10)),
        diaMes(asDezHorasDe(400)),
      ]);
    },
  },
  {
    // O quadro Vazio, com o menu do "+".
    nome: 'vazio-menu',
    async preparar(page) {
      const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
      await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
      await expect(page.getByText('Nenhuma conversa ainda', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Nova conversa ou novo grupo' }).click();
      await expect(page.getByRole('menu', { name: 'Nova conversa ou novo grupo' }).getByRole('menuitem')).toHaveText(['Nova conversa', 'Novo grupo']);
    },
  },
  {
    // O quadro NovaConversa: os colegas que já usam o chat.
    nome: 'nova-conversa',
    async preparar(page) {
      const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, BEATRIZ, CARLOS, JOAO, JORDANA, MARCOS]);
      await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
      await peloMais(page, 'Nova conversa');
      await expect(page.getByRole('list', { name: 'Colegas no chat' }).getByRole('button')).toHaveCount(6);
    },
  },
  {
    // O quadro NovoGrupo: o nome e duas pessoas escolhidas.
    nome: 'novo-grupo',
    async preparar(page) {
      const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, BEATRIZ, CARLOS, JOAO, JORDANA]);
      await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
      await peloMais(page, 'Novo grupo');
      await page.getByRole('textbox', { name: 'Nome do grupo' }).fill('Financeiro');
      await page.getByRole('checkbox', { name: /^Beatriz Ramos/ }).check();
      await page.getByRole('checkbox', { name: /^Carlos Lima/ }).check();
      await expect(page.getByRole('button', { name: 'Criar grupo com 3 pessoas' })).toBeEnabled();
      // As marcas rolam a lista até o Carlos: a foto mostra a lista desde o começo, com a primeira pessoa inteira.
      const lista = page.locator('.escolher-lista');
      await lista.evaluate((el) => {
        el.scrollTop = 0;
      });
      const area = (await lista.boundingBox())!;
      const primeira = (await lista.locator('.escolher-pessoa').first().boundingBox())!;
      expect(primeira.y >= area.y - 0.5 && primeira.y + primeira.height <= area.y + area.height + 0.5, 'a primeira pessoa inteira').toBe(true);
    },
  },
  {
    // O quadro Conversa, com o que não tem quadro (R42): no fim, o "Arquivo expirado" (um arquivo de um ano atrás, como
    // o servidor o manda depois dos 365 dias, com as mensagens daquele dia), o meu PDF de hoje e a foto da Ana com a
    // miniatura.
    nome: 'conversa',
    async preparar(page, janela) {
      const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
      const [eu, ana] = pessoas;
      const dupla = await ana.api.criarDupla(eu.pessoa.id);
      await eu.api.enviarTexto(dupla, 'Bom dia. Pode me mandar o pedido do mês?');
      await ana.api.enviarTexto(dupla, 'Segue o pedido. Qualquer dúvida, me liga.');
      const expirado = await ana.api.enviarArquivo(dupla, Buffer.alloc(49_152, 1), 'Pedido 4471.xlsx', XLSX);
      await eu.api.enviarArquivo(dupla, Buffer.alloc(1_258_291, 1), 'Proposta ACME.pdf', PDF);
      await ana.api.enviarFoto(dupla, PNG, 'Vitrine da loja.png', await imagemDaPagina(page, 480, 320));
      // As mensagens até o arquivo expirado são de um ano atrás; o arquivo chega como o servidor o manda depois de
      // expirar (sem o arquivo e sem a miniatura).
      await page.route(
        (url) => url.pathname === `/api/v1/conversas/${dupla}/mensagens`,
        async (rota) => {
          if (rota.request().method() !== 'GET') return rota.continue();
          const resposta = await rota.fetch();
          const json = await resposta.json();
          for (const m of json.mensagens) {
            if (m.id > expirado) continue;
            m.criadaEm -= 366 * DIA;
            if (m.arquivo) Object.assign(m.arquivo, { expirado: true, miniatura: false });
          }
          return rota.fulfill({ response: resposta, json });
        },
      );
      await abrirNoChat(page, { chave: eu.chave, ...RECEPCAO });
      await abrirAConversa(page, 'Ana Souza');
      const log = conversaCom(page, 'Ana Souza');
      await expect(log.locator('.balao-texto')).toHaveCount(2);
      await imagemAberta(log.getByRole('button', { name: 'Abrir a foto Vitrine da loja.png' }).locator('img'));
      const arquivo = log.getByRole('button', { name: 'Abrir Proposta ACME.pdf, 1,2 MB' });
      const foto = log.getByRole('button', { name: 'Abrir a foto Vitrine da loja.png' });
      const expirada = log.locator('.balao-expirado');
      await expect(expirada.getByText('Arquivo expirado', { exact: true })).toBeVisible();
      await expect(log.locator('.conversa-dia').last()).toHaveText('Hoje');
      // Nas janelas de 400×720 e de 360×600, os três inteiros na parte do log que aparece (a de 300×440 não tem altura
      // para os três).
      if (janela.altura >= 600) {
        const area = (await log.boundingBox())!;
        for (const balao of [expirada, arquivo, foto]) {
          const b = (await balao.boundingBox())!;
          expect(b.y >= area.y - 0.5 && b.y + b.height <= area.y + area.height + 0.5, `inteiro no log: ${JSON.stringify({ b, area })}`).toBe(true);
        }
      }
    },
  },
  {
    // O quadro Grupo: o nome de quem mandou em cima do balão, e os avisos no meio ("Beatriz Ramos pôs Carlos Lima no
    // grupo").
    nome: 'grupo',
    async preparar(page) {
      const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO, BEATRIZ, CARLOS]);
      const [eu, ana, joao, beatriz, carlos] = pessoas;
      const comercial = await beatriz.api.criarGrupo('Comercial', [eu.pessoa.id, ana.pessoa.id, joao.pessoa.id]);
      await joao.api.enviarTexto(comercial, 'Bom dia, pessoal. O pedido da ACME saiu?');
      await ana.api.enviarTexto(comercial, 'Saiu ontem à tarde.');
      await beatriz.api.porNoGrupo(comercial, [carlos.pessoa.id]);
      await eu.api.enviarTexto(comercial, 'Confirmei com o cliente agora.');
      await abrirNoChat(page, { chave: eu.chave, ...RECEPCAO });
      await abrirAConversa(page, 'Comercial');
      const log = page.getByRole('log', { name: 'Mensagens do grupo Comercial' });
      await expect(log.locator('.balao-texto')).toHaveCount(3);
      await expect(log.locator('.conversa-aviso').last()).toHaveText('Beatriz Ramos pôs Carlos Lima no grupo');
      await expect(page.getByRole('button', { name: 'Ver os membros do grupo Comercial' })).toContainText('5 pessoas · ver os membros');
    },
  },
  {
    // O quadro Membros: eu cuido do grupo, com 5 pessoas.
    nome: 'membros',
    async preparar(page) {
      const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, BEATRIZ, CARLOS, JOAO, JORDANA]);
      const [eu, ...outras] = pessoas;
      await eu.api.criarGrupo('Comercial', outras.slice(0, 4).map((p) => p.pessoa.id));
      await abrirNoChat(page, { chave: eu.chave, ...RECEPCAO });
      await abrirAConversa(page, 'Comercial');
      await page.getByRole('button', { name: 'Ver os membros do grupo Comercial' }).click();
      await expect(page.getByRole('heading', { name: 'Membros do grupo', level: 1 })).toBeVisible();
      await expect(page.locator('.membros .chat-pessoa')).toHaveCount(5);
    },
  },
  {
    // O quadro SemConexao: a faixa (os eventos não abrem) e uma mensagem "Não enviada" com o "Tentar de novo".
    nome: 'sem-conexao',
    async preparar(page) {
      const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
      const [eu, ana] = pessoas;
      const dupla = await ana.api.criarDupla(eu.pessoa.id);
      await ana.api.enviarTexto(dupla, 'Recebi a proposta, obrigada. Falta só o contrato.');
      // Cada conexão dos eventos fecha antes de abrir, e o envio falha (sem rede).
      await page.routeWebSocket(/\/api\/v1\/eventos\?/, (ws) => ws.close());
      await page.route(envios(dupla), (rota) => (rota.request().method() === 'POST' ? rota.abort() : rota.continue()));
      await abrirNoChat(page, { chave: eu.chave, ...RECEPCAO });
      await abrirAConversa(page, 'Ana Souza');
      await expect(page.getByRole('status').filter({ hasText: 'Sem conexão com o chat. Tentando de novo…' })).toBeVisible();
      await campoPara(page, 'Ana Souza').fill('Te mando o contrato em 5 minutos.');
      await campoPara(page, 'Ana Souza').press('Enter');
      const minha = conversaCom(page, 'Ana Souza').locator('.balao-meu');
      await expect(minha.getByText('Não enviada', { exact: true })).toBeVisible();
      await expect(minha.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
    },
  },
  {
    // Sem quadro (R42): os anexos em cima do campo, e um balão subindo, com a barra de progresso. O upload vai de verdade
    // pela rede lenta do Chromium (a de 256 KB/s até passar de 40%, e então a de 1 KB/s: a barra fica quase parada).
    nome: 'anexos',
    async preparar(page) {
      const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
      const [eu, ana] = pessoas;
      const dupla = await ana.api.criarDupla(eu.pessoa.id);
      await ana.api.enviarTexto(dupla, 'Pode me mandar o contrato e as fotos da fachada?');
      await abrirNoChat(page, { chave: eu.chave, ...RECEPCAO });
      await abrirAConversa(page, 'Ana Souza');
      const log = conversaCom(page, 'Ana Souza');
      await expect(log.locator('.balao-texto')).toHaveCount(1);
      const rede = await page.context().newCDPSession(page);
      const subirA = (bytesPorSegundo: number) =>
        rede.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: bytesPorSegundo });
      await rede.send('Network.enable');
      await subirA(256 * 1024);
      expect(await arrastar(page, [{ nome: 'Contrato ACME.pdf', tipo: PDF, tamanho: 1_048_576 }])).toBe(true);
      await botaoEnviar(page).click();
      const barra = log.getByRole('progressbar', { name: 'Contrato ACME.pdf' });
      await expect.poll(async () => Number(await barra.getAttribute('aria-valuenow')), { timeout: 10_000 }).toBeGreaterThanOrEqual(40);
      await subirA(1024);
      expect(
        await arrastar(page, [
          { nome: 'Fachada da loja.jpg', tipo: 'image/jpeg', tamanho: 1_572_864 },
          { nome: 'Pedido 4472.xlsx', tipo: XLSX, tamanho: 8192 },
        ]),
      ).toBe(true);
      await expect(page.locator('.anexo .anexo-nome')).toHaveText(['Fachada da loja.jpg', 'Pedido 4472.xlsx']);
    },
    async antesDaFoto(page) {
      // Na hora da foto, a barra está no meio (nem vazia nem cheia), dentro da parte do log que aparece.
      const log = conversaCom(page, 'Ana Souza');
      const barra = log.getByRole('progressbar', { name: 'Contrato ACME.pdf' });
      const valor = Number(await barra.getAttribute('aria-valuenow'));
      expect(valor, 'a barra parcial').toBeGreaterThanOrEqual(1);
      expect(valor, 'a barra parcial').toBeLessThanOrEqual(99);
      const b = (await barra.boundingBox())!;
      const area = (await log.boundingBox())!;
      const dentro = b.x >= area.x - 0.5 && b.y >= area.y - 0.5 && b.x + b.width <= area.x + area.width + 0.5 && b.y + b.height <= area.y + area.height + 0.5;
      expect(dentro, `a barra dentro do log: ${JSON.stringify({ b, area })}`).toBe(true);
    },
  },
  {
    // Sem quadro (R42): a foto grande, com o Fechar e o Baixar.
    nome: 'foto-grande',
    async preparar(page) {
      const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
      const [eu, ana] = pessoas;
      const dupla = await ana.api.criarDupla(eu.pessoa.id);
      const foto = await imagemDaPagina(page, 1200, 900, 'image/png');
      await ana.api.enviarFoto(dupla, foto, 'Vitrine da loja.png', await imagemDaPagina(page, 480, 360));
      await abrirNoChat(page, { chave: eu.chave, ...RECEPCAO });
      await abrirAConversa(page, 'Ana Souza');
      const balao = conversaCom(page, 'Ana Souza').getByRole('button', { name: 'Abrir a foto Vitrine da loja.png' });
      await imagemAberta(balao.locator('img'));
      await balao.click();
      const grande = page.getByRole('dialog', { name: 'Vitrine da loja.png' });
      await imagemAberta(grande.locator('img'));
      await expect.poll(() => grande.locator('img').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1200);
    },
  },
  {
    // A conta em uso que nunca se conectou à central neste computador.
    nome: 'precisa-conta',
    async preparar(page) {
      const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
      await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO, cenario: 'chat-sem-conta' });
      await expect(page.getByText('Conecte a sua conta para usar o chat.', { exact: true })).toBeVisible();
    },
  },
  {
    // O computador tirado do chat (a chave não vale mais).
    nome: 'fora',
    async preparar(page) {
      const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
      await pessoas[0].api.desligar();
      await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
      await expect(page.getByText('Este computador saiu do chat. Fale com o suporte da Starsonic.', { exact: true })).toBeVisible();
    },
  },
  {
    // O aviso de computador novo, na faixa da lista com o "×".
    nome: 'computador-novo',
    async preparar(page) {
      const { codigo, pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO]);
      const [eu, ana, joao] = pessoas;
      const comercial = await joao.api.criarGrupo('Comercial', [eu.pessoa.id, ana.pessoa.id]);
      await joao.api.enviarTexto(comercial, 'Fechamos o pedido de hoje.');
      const comAna = await ana.api.criarDupla(eu.pessoa.id);
      await ana.api.enviarTexto(comAna, 'Pode me mandar a proposta da ACME?');
      await abrirNoChat(page, { chave: eu.chave, ...RECEPCAO });
      await expect(page.locator('.chat-linha')).toHaveCount(2);
      // O aviso só vem pelos eventos.
      await esperarOsEventos(page);
      const outro = await ligarComputador(codigo, 'RECEPCAO-02');
      await new ApiDeTeste(outro.chave).entrar(RECEPCAO.ramal, RECEPCAO.nome);
      await expect(page.getByRole('status').filter({ hasText: 'Seu chat entrou em outro computador: RECEPCAO-02' })).toBeVisible();
    },
  },
  {
    // O quadro AdmChat, com o computador fora do chat; para o teclado, um código no campo (o "Ligar ao chat" ligado).
    nome: 'adm-chat',
    async preparar(page) {
      await abrirNoChat(page, { chave: '', ...RECEPCAO, cenario: 'chat-desligado' });
      await entrarNaAdmin(page);
      await expect(page.getByLabel('Código da empresa', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Ligar ao chat', exact: true })).toBeDisabled();
    },
    async antesDoTeclado(page) {
      await page.getByLabel('Código da empresa', { exact: true }).fill('STAR-AAAA-BBBB');
      await expect(page.getByRole('button', { name: 'Ligar ao chat', exact: true })).toBeEnabled();
    },
  },
  {
    // O quadro AdmChat, depois de ligado.
    nome: 'adm-chat-ligado',
    async preparar(page) {
      const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
      await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
      await expect(page.getByText('Nenhuma conversa ainda', { exact: true })).toBeVisible();
      await entrarNaAdmin(page);
      await expect(page.getByText('Ligado ao chat da ACME Comércio Ltda. A aba Chat já aparece no app.', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Desligar do chat' })).toBeEnabled();
    },
  },
];

for (const [largura, altura] of TAMANHOS) {
  for (const [esquema, tema] of TEMAS) {
    test.describe(`as fotos em ${largura}×${altura} (${tema})`, () => {
      test.use({ viewport: { width: largura, height: altura }, colorScheme: esquema });

      for (const tela of TELAS) {
        test(`chat-${tela.nome}: the photo, no serious violations, and Tab reaches every control without losing the focus`, async ({ page }) => {
          await tela.preparar(page, { largura, altura });
          await semViolacoesSerias(page);
          if (tela.antesDaFoto) await tela.antesDaFoto(page);
          await capturar(page, `chat-${tela.nome}-${largura}x${altura}`, tema);
          if (tela.antesDoTeclado) await tela.antesDoTeclado(page);
          await conferirOTeclado(page);
        });
      }
    });
  }
}
