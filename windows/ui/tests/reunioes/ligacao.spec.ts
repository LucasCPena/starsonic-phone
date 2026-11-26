// A ligação no meio da reunião dentro do app (plano 3b, Task 6): a ligação que toca mostra o cartão da tela 12 por
// cima da página, sem mexer no tamanho da janela; o Atender (o answer sem vídeo) põe a reunião em pausa (o pausar à
// página), esconde a vista e mostra a tela da ligação com a faixa da tela 13; o "Voltar para a reunião" põe a ligação
// em espera e volta, com o cartão da espera; o fim da ligação tira a pausa e devolve a reunião no tamanho em que ela
// estava. A reunião é sempre o mesmo documento do iframe (o marcar e o marcada da paginaFalsa). As ligações chegam
// pelo mudarEstado, e os botões mudam o estado pela ponte falsa (o answer, o hold, o hangup, o reject).
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  capturar,
  comandos,
  depoisDoQueChegou,
  esperarComando,
  mudarEstado,
  semViolacoesSerias,
  type Comando,
} from '../helpers';
import { empresaComReunioes } from '../chat/servidor';
import { esperarOsEventos } from '../chat/abrir';
import { abrirNasReunioes, comEventos, marcar, meioDiaDeHoje, noRelogioDaPagina, paginaFalsa } from './abrir';

// O CSP da página só deixa falar com o endereço do chat de verdade; o servidor de teste fica no 127.0.0.1:4180.
test.use({ bypassCSP: true });

const EMPRESA = 'ACME Comércio Ltda';
const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
const PLANEJAMENTO = 'Planejamento de dezembro';
const LIGACAO_DE = 'Ligação de Marcos Teixeira';
const TOCANDO = 'Ramal 2015 · tocando';
const ATENDER_TIRA = 'Atender tira você da reunião enquanto a ligação durar.';
const FORA = 'Você está fora da reunião';
const NA_REUNIAO = 'Você está na reunião';
const VOLTAR = 'Voltar para a reunião';
const EM_ESPERA = 'Marcos Teixeira em espera';
const VOLTAR_A_LIGACAO = 'Voltar à ligação';
const EM_LIGACAO = 'Ocupado · em ligação';
const EM_REUNIAO = 'Ocupado · em reunião';
const OUVINDO = 'A reunião no navegador continua ouvindo você. Desligue o microfone lá.';
const TAMANHOS: Array<[number, number, string]> = [
  [400, 720, 'normal'],
  [360, 600, 'compacto'],
  [300, 440, 'minimo'],
];

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

const SEM_VIDEO = { oferece: false, ativo: false, imagem: false, camera: false, cedo: false };
const MARCOS = { id: 51, number: '2015', name: 'Marcos Teixeira', incoming: true, held: false };
const ANA = { id: 52, number: '2003', name: 'Ana Souza', incoming: true, held: false };
type Fase = 'ringing' | 'dialing' | 'active';
type Quem = { id: number; number: string; name: string; incoming: boolean; held: boolean };

/** Um cartão de ligação no estado; o atendido conta o tempo pelo relógio da página (fixo no meio-dia). */
function cartao(quem: Quem, phase: Fase, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...quem,
    phase,
    activeSinceMs: phase === 'active' ? meioDiaDeHoje() - 5_000 : 0,
    video: SEM_VIDEO,
    ...extra,
  };
}

/** O `ligacao` do estado, com a de cima e o que mais o teste pedir (a segunda, a conferência, a consulta). */
function ligacao(top: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    top,
    second: null,
    secondKind: 'none',
    muted: false,
    conference: false,
    conferenceSinceMs: 0,
    consulting: false,
    colleagueActive: false,
    sala: null,
    ...extra,
  };
}

const quadro = (page: Page) => page.locator('iframe[title="Reunião"]');
const botao = (page: Page, nome: string) => page.getByRole('button', { name: nome, exact: true });
const linhaDe = (page: Page, assunto: string) => page.getByRole('article').filter({ hasText: assunto });
const regiao = (page: Page, nome: string) => page.getByRole('region', { name: nome, exact: true });
const cartaoQueToca = (page: Page) => regiao(page, LIGACAO_DE);
const cartaoDaEspera = (page: Page) => regiao(page, EM_ESPERA);
const faixaFora = (page: Page) => regiao(page, FORA);
const telaDaLigacao = (page: Page) => page.getByRole('main', { name: 'Ligação' });
/** A barra de título da vista da reunião, e a do app de sempre (a da vista escondida não conta). */
const barraDaVista = (page: Page) => page.locator('.reuniao .titlebar');
const barraDoApp = (page: Page) => page.locator('.win:not(.reuniao) .titlebar');
const doTipo = async (page: Page, cmd: string): Promise<Comando[]> =>
  (await comandos(page)).filter((c) => c.cmd === cmd);
const janelas = async (page: Page) => (await doTipo(page, 'videoWindow')).map((c) => c.modo);
const nomeDoTema = (tema: 'light' | 'dark') => (tema === 'light' ? 'claro' : 'escuro');

type Pagina = Awaited<ReturnType<typeof paginaFalsa>>;
/** Os `tipo` do que o app mandou à página, na ordem. */
const tipos = async (pagina: Pagina) => (await pagina.recebidas()).map((m) => (m as { tipo?: string }).tipo);
/** Só o pausar e o retomar, na ordem. */
const pausas = async (pagina: Pagina) => (await tipos(pagina)).filter((t) => t === 'pausar' || t === 'retomar');

interface Aberta {
  codigo: string;
  pagina: Pagina;
  eventos: Awaited<ReturnType<typeof comEventos>> | null;
}

/**
 * Abre o app nas Reuniões com uma reunião marcada, entra nela pelo app, e a página diz a fase (a pessoa na reunião, ou
 * ainda na entrada). A marca fica no documento do iframe: o marcada() diz se ele é o mesmo depois. `eventos`: os
 * eventos da reunião pelo comEventos.
 */
async function naReuniao(page: Page, o: { fase?: 'naReuniao' | 'entrada'; eventos?: boolean } = {}): Promise<Aberta> {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const codigo = (await marcar(pessoas[0].api, noRelogioDaPagina(0, 14, 0), PLANEJAMENTO)).codigo;
  const pagina = await paginaFalsa(page, codigo);
  const eventos = o.eventos ? await comEventos(page) : null;
  await page.clock.setFixedTime(meioDiaDeHoje());
  await abrirNasReunioes(page, { chave: pessoas[0].chave, ...RECEPCAO });
  if (eventos) await esperarOsEventos(page);
  await linhaDe(page, PLANEJAMENTO).getByRole('button', { name: 'Entrar', exact: true }).click();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'grande' });
  await expect(quadro(page)).toBeVisible();
  await expect.poll(async () => (await tipos(pagina)).filter((t) => t === 'passe').length).toBe(1);
  const fase = o.fase ?? 'naReuniao';
  await pagina.mandar({ tipo: 'estado', fase, microfone: true });
  // O estado chegou ao app: na reunião, a barra diz; na entrada, um link mandado depois dele já foi tratado.
  if (fase === 'naReuniao') {
    await expect(barraDaVista(page)).toContainText(EM_REUNIAO);
  } else {
    await pagina.mandar({ tipo: 'link', url: 'https://exemplo.com/depois-do-estado' });
    await esperarComando(page, { cmd: 'reuniaoLink', url: 'https://exemplo.com/depois-do-estado' });
  }
  await pagina.marcar();
  return { codigo, pagina, eventos };
}

/** A ligação do Marcos tocando, e o cartão dela por cima da reunião. */
async function tocaOMarcos(page: Page): Promise<void> {
  await mudarEstado(page, (s) => ({ ...s, ligacao: ligacao(cartao(MARCOS, 'ringing')) }));
  await expect(cartaoQueToca(page)).toBeVisible();
}

/** O Marcos toca e a pessoa atende pelo cartão: a tela da ligação, com a faixa da tela 13. */
async function atendeOMarcos(page: Page): Promise<void> {
  await tocaOMarcos(page);
  await cartaoQueToca(page).getByRole('button', { name: 'Atender', exact: true }).click();
  await expect(faixaFora(page)).toBeVisible();
}

test('uma ligação que chega mostra o cartão por cima da reunião', async ({ page }) => {
  const { pagina } = await naReuniao(page);
  await tocaOMarcos(page);
  const card = cartaoQueToca(page);
  await expect(card.getByText(LIGACAO_DE, { exact: true })).toBeVisible();
  await expect(card.getByText(TOCANDO, { exact: true })).toBeVisible();
  await expect(card.getByText(ATENDER_TIRA, { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Recusar', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Atender', exact: true })).toBeVisible();
  await expect(card.getByRole('button')).toHaveCount(2);
  // A reunião continua: à vista, sem pausa, no mesmo tamanho e no mesmo documento; a barra continua "em reunião".
  await expect(quadro(page)).toBeVisible();
  await expect(barraDaVista(page).locator('.account-status-text')).toHaveText(EM_REUNIAO);
  expect(await tipos(pagina)).not.toContain('pausar');
  expect(await janelas(page)).toEqual(['grande']);
  expect(await pagina.marcada()).toBe(true);
  // Os botões do cartão vêm antes da página na ordem do Tab.
  expect(
    await page.evaluate(() => {
      const atender = [...document.querySelectorAll('.reuniao-vista button')].find(
        (b) => b.getAttribute('aria-label') === 'Atender',
      )!;
      const iframe = document.querySelector('iframe[title="Reunião"]')!;
      return (atender.compareDocumentPosition(iframe) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    }),
  ).toBe(true);

  // Com duas tocando, o cartão é o da de cima (a tela da ligação embaixo da vista tem o da segunda).
  await mudarEstado(page, (s) => ({
    ...s,
    ligacao: ligacao(cartao(MARCOS, 'ringing'), { second: cartao(ANA, 'ringing'), secondKind: 'ringing' }),
  }));
  await expect(page.locator('.tela-de-baixo').getByText('Ligação de Ana Souza', { exact: true })).toHaveCount(1);
  await expect(page.locator('.reuniao-vista').getByText('Ligação de Ana Souza', { exact: true })).toHaveCount(0);
  await expect(card).toBeVisible();

  // O Recusar: o reject. A ligação acaba, o núcleo põe a janela no normal, e a vista manda o tamanho dela de novo.
  await card.getByRole('button', { name: 'Recusar', exact: true }).click();
  await esperarComando(page, { cmd: 'reject' });
  await expect(card).toHaveCount(0);
  await expect.poll(() => janelas(page)).toEqual(['grande', 'grande']);
  await expect(quadro(page)).toBeVisible();
  expect(await tipos(pagina)).not.toContain('pausar');
  expect(await pagina.marcada()).toBe(true);
});

test('o Atender tira a pessoa da reunião enquanto a ligação dura', async ({ page }) => {
  const { pagina } = await naReuniao(page);
  await atendeOMarcos(page);
  // O answer, sem o vídeo.
  expect(await doTipo(page, 'answer')).toEqual([{ v: 1, cmd: 'answer' }]);
  await expect.poll(() => pausas(pagina)).toEqual(['pausar']);
  expect(await janelas(page)).toEqual(['grande', 'normal']);
  // A tela da ligação de sempre, com a faixa da tela 13 logo abaixo da barra.
  await expect(telaDaLigacao(page)).toBeVisible();
  await expect(faixaFora(page).getByText(FORA, { exact: true })).toBeVisible();
  await expect(faixaFora(page).getByText(PLANEJAMENTO, { exact: true })).toBeVisible();
  await expect(faixaFora(page).getByRole('button', { name: VOLTAR, exact: true })).toBeVisible();
  await expect(regiao(page, NA_REUNIAO)).toHaveCount(0);
  await expect(barraDoApp(page).locator('.account-status-text')).toHaveText(EM_LIGACAO);
  expect(
    await page.evaluate(() => {
      const barra = document.querySelector('.win:not(.reuniao) .titlebar')!;
      return barra.nextElementSibling?.getAttribute('aria-label');
    }),
  ).toBe(FORA);
  // O Atender saiu com a vista escondida: o foco vai para a faixa, e não para o fundo.
  await expect(faixaFora(page)).toBeFocused();
  // A vista fica escondida, fora do Tab e do leitor de tela, e a tela da ligação é a que a pessoa usa.
  await expect(quadro(page)).toBeHidden();
  await expect(page.locator('.reuniao-vista[inert]')).toHaveCount(1);
  await expect(page.locator('.tela-de-baixo[inert]')).toHaveCount(0);
  expect(await pagina.marcada()).toBe(true);
});

test('quando a ligação acaba, a reunião volta como estava', async ({ page }) => {
  const { pagina } = await naReuniao(page);
  await botao(page, 'Tela cheia').click();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'telaCheia' });
  await atendeOMarcos(page);
  await telaDaLigacao(page).getByRole('button', { name: 'Desligar', exact: true }).click();
  await esperarComando(page, { cmd: 'hangup', id: MARCOS.id });
  await expect(quadro(page)).toBeVisible();
  await expect(faixaFora(page)).toHaveCount(0);
  await expect.poll(() => pausas(pagina)).toEqual(['pausar', 'retomar']);
  // O núcleo põe a janela no normal no fim da ligação; a vista manda o tamanho dela depois, uma vez.
  expect(await janelas(page)).toEqual(['grande', 'telaCheia', 'normal', 'telaCheia']);
  await expect(botao(page, 'Sair da tela cheia')).toBeVisible();
  await expect(page.locator('.tela-de-baixo[inert]')).toHaveCount(1);
  await expect(quadro(page)).toBeFocused();
  expect(await pagina.marcada()).toBe(true);
});

test('o Voltar para a reunião põe a ligação em espera', async ({ page }) => {
  const { pagina } = await naReuniao(page);
  await atendeOMarcos(page);
  await faixaFora(page).getByRole('button', { name: VOLTAR, exact: true }).click();
  await esperarComando(page, { cmd: 'hold', on: true });
  // Com a ligação em espera: o retomar, a vista no tamanho dela e o cartão da espera.
  await expect(cartaoDaEspera(page)).toBeVisible();
  await expect(quadro(page)).toBeVisible();
  await expect(faixaFora(page)).toHaveCount(0);
  await expect.poll(() => pausas(pagina)).toEqual(['pausar', 'retomar']);
  expect(await janelas(page)).toEqual(['grande', 'normal', 'grande']);
  await expect(cartaoDaEspera(page).getByText(EM_ESPERA, { exact: true })).toBeVisible();
  await expect(cartaoDaEspera(page).getByRole('button', { name: VOLTAR_A_LIGACAO, exact: true })).toBeVisible();
  await expect(cartaoDaEspera(page).getByRole('button', { name: 'Desligar', exact: true })).toBeVisible();
  await expect(barraDaVista(page).locator('.account-status-text')).toHaveText(EM_REUNIAO);
  expect(await pagina.marcada()).toBe(true);

  // O Voltar à ligação: a ligação sai da espera, e a pausa volta, com a janela normal e a tela da ligação.
  await cartaoDaEspera(page).getByRole('button', { name: VOLTAR_A_LIGACAO, exact: true }).click();
  await esperarComando(page, { cmd: 'hold', on: false });
  await expect(faixaFora(page)).toBeVisible();
  await expect(telaDaLigacao(page)).toBeVisible();
  await expect(quadro(page)).toBeHidden();
  await expect.poll(() => pausas(pagina)).toEqual(['pausar', 'retomar', 'pausar']);
  expect(await janelas(page)).toEqual(['grande', 'normal', 'grande', 'normal']);

  // De novo em espera, e o Desligar do cartão: o hangup. A reunião fica, e a vista manda o tamanho dela de novo.
  await faixaFora(page).getByRole('button', { name: VOLTAR, exact: true }).click();
  await expect(cartaoDaEspera(page)).toBeVisible();
  await cartaoDaEspera(page).getByRole('button', { name: 'Desligar', exact: true }).click();
  await esperarComando(page, { cmd: 'hangup', id: MARCOS.id });
  await expect(cartaoDaEspera(page)).toHaveCount(0);
  await expect(quadro(page)).toBeVisible();
  await expect.poll(() => janelas(page)).toEqual(['grande', 'normal', 'grande', 'normal', 'grande', 'grande']);
  expect(await pausas(pagina)).toEqual(['pausar', 'retomar', 'pausar', 'retomar']);
  expect(await pagina.marcada()).toBe(true);
});

test('a ligação que sai da espera por outro caminho tira a espera do Voltar', async ({ page }) => {
  const { pagina } = await naReuniao(page);
  await atendeOMarcos(page);
  await faixaFora(page).getByRole('button', { name: VOLTAR, exact: true }).click();
  await expect(cartaoDaEspera(page)).toBeVisible();
  await expect.poll(() => pausas(pagina)).toEqual(['pausar', 'retomar']);
  // A ligação sai da espera sem o Voltar à ligação (pelo núcleo): a pausa volta, com a tela da ligação.
  await mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, top: { ...s.ligacao.top, held: false } } }));
  await expect(faixaFora(page)).toBeVisible();
  await expect.poll(() => pausas(pagina)).toEqual(['pausar', 'retomar', 'pausar']);
  // Em espera de novo, agora pela Espera da tela da ligação: a pausa continua (o emEspera do Voltar já saiu).
  await telaDaLigacao(page).getByRole('button', { name: 'Espera', exact: true }).click();
  await esperarComando(page, { cmd: 'hold', on: true });
  await depoisDoQueChegou(page);
  await expect(faixaFora(page)).toBeVisible();
  await expect(cartaoDaEspera(page)).toHaveCount(0);
  expect(await pausas(pagina)).toEqual(['pausar', 'retomar', 'pausar']);
  expect(await janelas(page)).toEqual(['grande', 'normal', 'grande', 'normal']);
  expect(await pagina.marcada()).toBe(true);
});

test('o Voltar para a reunião só com uma ligação já atendida', async ({ page }) => {
  await naReuniao(page);
  const semVoltar: Array<[string, Record<string, unknown>]> = [
    ['chamando', ligacao(cartao({ ...MARCOS, incoming: false }, 'dialing'))],
    [
      'com a segunda em espera',
      ligacao(cartao(MARCOS, 'active'), { second: cartao({ ...ANA, held: true }, 'active'), secondKind: 'held' }),
    ],
    [
      'com a segunda tocando',
      ligacao(cartao(MARCOS, 'active'), { second: cartao(ANA, 'ringing'), secondKind: 'ringing' }),
    ],
    [
      'na conferência',
      ligacao(cartao(MARCOS, 'active'), {
        second: cartao(ANA, 'active'),
        secondKind: 'active',
        conference: true,
        conferenceSinceMs: meioDiaDeHoje() - 2_000,
      }),
    ],
    [
      'na consulta',
      ligacao(cartao({ ...ANA, incoming: false }, 'active'), {
        second: cartao({ ...MARCOS, held: true }, 'active'),
        secondKind: 'held',
        consulting: true,
        colleagueActive: true,
      }),
    ],
  ];
  for (const [caso, l] of semVoltar) {
    await mudarEstado(page, (s) => ({ ...s, ligacao: l }));
    // O estado deste caso já chegou à tela (a faixa do caso de antes também não tinha o botão).
    await depoisDoQueChegou(page);
    await expect(faixaFora(page), caso).toBeVisible();
    await expect(faixaFora(page).getByText(PLANEJAMENTO, { exact: true }), caso).toBeVisible();
    await expect(faixaFora(page).getByRole('button'), caso).toHaveCount(0);
  }
  // Uma só, já atendida: com o botão.
  await mudarEstado(page, (s) => ({ ...s, ligacao: ligacao(cartao(MARCOS, 'active')) }));
  await expect(faixaFora(page).getByRole('button', { name: VOLTAR, exact: true })).toBeVisible();
});

test('numa reunião, a ligação é só de voz', async ({ page }) => {
  const { pagina } = await naReuniao(page);
  await botao(page, 'Telefone').click();
  await expect(regiao(page, NA_REUNIAO)).toBeVisible();
  // No Telefone, a ligação que oferece vídeo toca como sempre, mas sem o Atender com vídeo.
  const comVideo = cartao(MARCOS, 'ringing', { video: { ...SEM_VIDEO, oferece: true } });
  await mudarEstado(page, (s) => ({ ...s, ligacao: ligacao(comVideo) }));
  await expect(telaDaLigacao(page).getByRole('button', { name: 'Atender', exact: true })).toBeVisible();
  await expect(telaDaLigacao(page).getByRole('button', { name: 'Recusar', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Atender com vídeo', exact: true })).toHaveCount(0);
  // Atendida (a ponte falsa liga o vídeo da outra ponta, que oferecia): a Câmera desligada e sem efeito, e nenhum
  // Adicionar pessoa (a sala não se monta). A imagem que chega fica, sem o Abrir grande: a janela é a da reunião.
  await telaDaLigacao(page).getByRole('button', { name: 'Atender', exact: true }).click();
  await expect(faixaFora(page)).toBeVisible();
  await expect.poll(() => pausas(pagina)).toEqual(['pausar']);
  const camera = telaDaLigacao(page).getByRole('button', { name: 'Ligar a câmera', exact: true });
  await expect(camera).toBeVisible();
  await expect(camera).toBeDisabled();
  await camera.click({ force: true });
  await expect(page.getByRole('button', { name: 'Adicionar pessoa', exact: true })).toHaveCount(0);
  await expect(telaDaLigacao(page).locator('.video-caixa')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir grande', exact: true })).toHaveCount(0);
  // O Mudo, clicado depois, chega à ponte: o clique na Câmera, antes dele, não mandou nada.
  await telaDaLigacao(page).getByRole('button', { name: 'Mudo', exact: true }).click();
  await esperarComando(page, { cmd: 'mute', on: true });
  expect(await doTipo(page, 'camera')).toEqual([]);
  expect(await doTipo(page, 'answer')).toEqual([{ v: 1, cmd: 'answer' }]);
});

test('uma ligação feita do Telefone também tira da reunião', async ({ page }) => {
  const { pagina } = await naReuniao(page);
  await botao(page, 'Telefone').click();
  await expect(regiao(page, NA_REUNIAO)).toBeVisible();
  // A ligação feita, ainda chamando: a pausa começa, e a faixa é a da tela 13, sem o Voltar.
  await mudarEstado(page, (s) => ({ ...s, ligacao: ligacao(cartao({ ...ANA, id: 0, incoming: false }, 'dialing')) }));
  await expect(faixaFora(page)).toBeVisible();
  await expect(regiao(page, NA_REUNIAO)).toHaveCount(0);
  await expect.poll(() => pausas(pagina)).toEqual(['pausar']);
  await expect(faixaFora(page).getByRole('button')).toHaveCount(0);
  await expect(barraDoApp(page).locator('.account-status-text')).toHaveText(EM_LIGACAO);
  // A janela já estava no tamanho normal (o Telefone).
  expect(await janelas(page)).toEqual(['grande', 'normal']);
  // Atendida do outro lado: o Voltar aparece.
  await mudarEstado(page, (s) => ({ ...s, ligacao: ligacao(cartao({ ...ANA, id: 53, incoming: false }, 'active')) }));
  await expect(faixaFora(page).getByRole('button', { name: VOLTAR, exact: true })).toBeVisible();
  // O fim: o retomar, e a reunião de volta no tamanho dela.
  await mudarEstado(page, (s) => ({ ...s, ligacao: null }));
  await expect(quadro(page)).toBeVisible();
  await expect(faixaFora(page)).toHaveCount(0);
  await expect.poll(() => pausas(pagina)).toEqual(['pausar', 'retomar']);
  expect(await janelas(page)).toEqual(['grande', 'normal', 'grande']);
  expect(await pagina.marcada()).toBe(true);
});

test('a pausa vai de novo quando a pessoa entra', async ({ page }) => {
  const { pagina } = await naReuniao(page);
  await mudarEstado(page, (s) => ({ ...s, ligacao: ligacao(cartao(MARCOS, 'active')) }));
  await expect(faixaFora(page)).toBeVisible();
  await expect.poll(() => pausas(pagina)).toEqual(['pausar']);
  // A página entra de novo (o chat reiniciou), com a ligação no ar: a fase passa a naReuniao, e a pausa vai de novo.
  await pagina.mandar({ tipo: 'estado', fase: 'entrada', microfone: false });
  await pagina.mandar({ tipo: 'estado', fase: 'naReuniao', microfone: false });
  await expect.poll(() => pausas(pagina)).toEqual(['pausar', 'pausar']);
  // Um estado que não passa a naReuniao (o microfone que muda) não manda de novo.
  await pagina.mandar({ tipo: 'estado', fase: 'naReuniao', microfone: true });
  await pagina.mandar({ tipo: 'link', url: 'https://exemplo.com/sentinela' });
  await esperarComando(page, { cmd: 'reuniaoLink', url: 'https://exemplo.com/sentinela' });
  expect(await pausas(pagina)).toEqual(['pausar', 'pausar']);
  // A faixa continua: a pessoa segue na ligação.
  await expect(faixaFora(page)).toBeVisible();
  expect(await pagina.marcada()).toBe(true);
});

test('o atender automático também pausa', async ({ page }) => {
  const { pagina } = await naReuniao(page);
  // O estado vai direto a active, sem o Atender da pessoa.
  await mudarEstado(page, (s) => ({ ...s, ligacao: ligacao(cartao(MARCOS, 'active')) }));
  await expect(faixaFora(page)).toBeVisible();
  await expect(telaDaLigacao(page)).toBeVisible();
  await expect.poll(() => pausas(pagina)).toEqual(['pausar']);
  expect(await janelas(page)).toEqual(['grande', 'normal']);
  expect(await doTipo(page, 'answer')).toEqual([]);
  await expect(quadro(page)).toBeHidden();
  expect(await pagina.marcada()).toBe(true);
});

test('uma ligação atendida antes de entrar fecha a entrada', async ({ page }) => {
  await naReuniao(page, { fase: 'entrada' });
  await tocaOMarcos(page);
  await cartaoQueToca(page).getByRole('button', { name: 'Atender', exact: true }).click();
  await esperarComando(page, { cmd: 'answer' });
  // A vista fecha (a câmera da prévia apaga), sem faixa e sem pausa: a tela da ligação de sempre.
  await expect(quadro(page)).toHaveCount(0);
  await expect(telaDaLigacao(page)).toBeVisible();
  await expect(faixaFora(page)).toHaveCount(0);
  await expect(regiao(page, NA_REUNIAO)).toHaveCount(0);
  expect(await janelas(page)).toEqual(['grande', 'normal']);
  // O fim da ligação não traz a vista de volta.
  await telaDaLigacao(page).getByRole('button', { name: 'Desligar', exact: true }).click();
  await expect(telaDaLigacao(page)).toHaveCount(0);
  await depoisDoQueChegou(page);
  await expect(quadro(page)).toHaveCount(0);
  expect(await janelas(page)).toEqual(['grande', 'normal']);
});

test('a reunião de dentro do app nunca diz que a do navegador continua ouvindo', async ({ page }) => {
  const { codigo, eventos } = await naReuniao(page, { eventos: true });
  // Os eventos põem o computador na reunião; o chat avisa que vai desligar e, na volta, não o conhece mais nela (o 409
  // da conferência): é a dúvida da 7.9, que deixaria uma reunião do navegador "ouvindo" a pessoa.
  const participante = { id: 'aaaaaaaaaaaaaaaa', nome: RECEPCAO.nome, deFora: false, tela: true };
  await eventos!.mandar({ tipo: 'reuniaoParticipantes', reuniao: codigo, participantes: [participante], pedidos: [] });
  const conferida = page.waitForResponse(
    (r) => new URL(r.url()).pathname === `/api/v1/reunioes/${codigo}/participantes` && r.status() === 409,
  );
  await eventos!.derrubar({ desligando: true });
  eventos!.voltar();
  await conferida;
  // Uma ligação atendida: a tela da ligação tem a região da frase, e ela fica vazia.
  await mudarEstado(page, (s) => ({ ...s, ligacao: ligacao(cartao(MARCOS, 'active')) }));
  await expect(faixaFora(page)).toBeVisible();
  const frase = page.getByRole('status').and(page.locator('.call-ouvindo'));
  await expect(frase).toHaveCount(1);
  await page.evaluate(() => fetch('/index.html').then((r) => r.text()));
  await expect(frase).toHaveText('');
  await expect(page.getByText(OUVINDO, { exact: true })).toHaveCount(0);
});

for (const tema of ['light', 'dark'] as const) {
  test(`o cartão e a faixa da ligação não têm violações sérias (${nomeDoTema(tema)})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: tema });
    await naReuniao(page);
    await tocaOMarcos(page);
    await semViolacoesSerias(page);
    await capturar(page, 'reuniao-ligacao-toca', tema);
    await cartaoQueToca(page).getByRole('button', { name: 'Atender', exact: true }).click();
    await expect(faixaFora(page)).toBeVisible();
    await semViolacoesSerias(page);
    await capturar(page, 'reuniao-ligacao-faixa', tema);
    await faixaFora(page).getByRole('button', { name: VOLTAR, exact: true }).click();
    await expect(cartaoDaEspera(page)).toBeVisible();
    await semViolacoesSerias(page);
    await capturar(page, 'reuniao-ligacao-espera', tema);
  });
}

/** O texto inteiro, dentro da janela e sem corte. */
async function inteiro(alvo: Locator, largura: number, onde: string) {
  await expect(alvo, onde).toBeVisible();
  const caixa = (await alvo.boundingBox())!;
  expect(caixa.x, onde).toBeGreaterThanOrEqual(0);
  expect(caixa.x + caixa.width, onde).toBeLessThanOrEqual(largura);
  const cortado = await alvo.evaluate((e) => e.scrollWidth > e.clientWidth + 0.5);
  expect(cortado, `cortado em ${onde}`).toBe(false);
}

test('a faixa da ligação cabe nos três tamanhos', async ({ page }) => {
  await naReuniao(page);
  await atendeOMarcos(page);
  for (const [largura, altura, layout] of TAMANHOS) {
    const onde = `${largura}×${altura}`;
    await page.setViewportSize({ width: largura, height: altura });
    await expect(page.locator('.win:not(.reuniao)')).toHaveAttribute('data-layout', layout);
    for (const texto of [FORA, PLANEJAMENTO, VOLTAR]) {
      await inteiro(faixaFora(page).getByText(texto, { exact: true }), largura, `${texto} em ${onde}`);
    }
    // A barra de título cabe, com o estado inteiro.
    const estado = barraDoApp(page).locator('.account-status-text');
    await expect(estado, onde).toHaveText(EM_LIGACAO);
    expect(await estado.evaluate((e) => e.scrollWidth > e.clientWidth + 0.5), `estado cortado em ${onde}`).toBe(false);
    const caixaDaFaixa = (await faixaFora(page).boundingBox())!;
    expect(caixaDaFaixa.x + caixaDaFaixa.width, onde).toBeLessThanOrEqual(largura);
    // O Desligar da tela da ligação continua à vista, abaixo da faixa.
    const desligar = (await telaDaLigacao(page).getByRole('button', { name: 'Desligar', exact: true }).boundingBox())!;
    expect(desligar.y + desligar.height, onde).toBeLessThanOrEqual(altura);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth), onde).toBeLessThanOrEqual(largura);
    await semViolacoesSerias(page);
  }
});

test('os cartões da ligação cabem nos três tamanhos', async ({ page }) => {
  await naReuniao(page);
  await tocaOMarcos(page);
  const verCartao = async (cartaoDaVez: Locator, textos: string[], botoes: string[]) => {
    for (const [largura, altura, layout] of TAMANHOS) {
      const onde = `${largura}×${altura}`;
      await page.setViewportSize({ width: largura, height: altura });
      await expect(page.locator('.win.reuniao')).toHaveAttribute('data-layout', layout);
      for (const texto of textos) {
        await inteiro(cartaoDaVez.getByText(texto, { exact: true }), largura, `${texto} em ${onde}`);
      }
      for (const nome of botoes) {
        const caixa = (await cartaoDaVez.getByRole('button', { name: nome, exact: true }).boundingBox())!;
        expect(caixa.x + caixa.width, `${nome} em ${onde}`).toBeLessThanOrEqual(largura);
        expect(caixa.width, `${nome} em ${onde}`).toBeGreaterThanOrEqual(24);
      }
      const caixa = (await cartaoDaVez.boundingBox())!;
      expect(caixa.x, onde).toBeGreaterThanOrEqual(0);
      expect(caixa.x + caixa.width, onde).toBeLessThanOrEqual(largura);
      // No alto e no meio da página, logo abaixo da barra da vista.
      const barra = (await barraDaVista(page).boundingBox())!;
      expect(Math.abs(caixa.x + caixa.width / 2 - largura / 2), onde).toBeLessThanOrEqual(1);
      expect(caixa.y, onde).toBeGreaterThanOrEqual(barra.y + barra.height);
      expect(caixa.y, onde).toBeLessThanOrEqual(barra.y + barra.height + 16);
      expect(await page.evaluate(() => document.scrollingElement!.scrollWidth), onde).toBeLessThanOrEqual(largura);
      await semViolacoesSerias(page);
    }
    await page.setViewportSize({ width: 400, height: 720 });
  };
  await verCartao(cartaoQueToca(page), [LIGACAO_DE, TOCANDO, ATENDER_TIRA], ['Recusar', 'Atender']);
  await cartaoQueToca(page).getByRole('button', { name: 'Atender', exact: true }).click();
  await faixaFora(page).getByRole('button', { name: VOLTAR, exact: true }).click();
  await expect(cartaoDaEspera(page)).toBeVisible();
  await verCartao(cartaoDaEspera(page), [EM_ESPERA], [VOLTAR_A_LIGACAO, 'Desligar']);
});
