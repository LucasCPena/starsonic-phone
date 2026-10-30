// A área do toque de 44×44 px (os 44 pontos do iPhone) de todo alvo das telas do iPhone, sem lista à mão dos alvos: em
// cada tela, cada botão, campo, lista de escolha, link, papel de botão ou de item de menu e rótulo que envolve um campo
// (os segmentos UDP/TCP, a busca), visível e inteiro na tela, medido pela bissecção do elementFromPoint (ios-helpers.ts).
// Um alvo fora dos 44 px só passa com o motivo escrito na lista SEM_44, abaixo: um alvo novo esquecido falha. As áreas
// também não se cobrem (cada toque cai no alvo que a pessoa vê). Num tema só: o tema não muda as medidas.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { abrirIos, alvosDeToque, areasQueSeCobrem, medirAreas, menoresQue44, noIphone, TAMANHOS_IPHONE, type TamanhoIphone } from './ios-helpers';

/**
 * Os alvos que ficam fora dos 44 px, cada um com a tela, o nome do alvo (o das mensagens: o aria-label, o texto ou o
 * placeholder) e o motivo. Hoje nenhum: todo alvo das telas do iPhone tem a área de 44 px (as regras do app.css, no fim).
 */
const SEM_44: Array<{ tela: string; alvo: string; porque: string }> = [];

/** Abre uma tela do iPhone e devolve a parte dela que tem os alvos (a página, um diálogo aberto ou o menu aberto). */
type AbrirTela = (page: Page, tamanho: TamanhoIphone) => Promise<Locator>;

function botao(page: Page, nome: string): Locator {
  return page.getByRole('button', { name: nome, exact: true });
}

async function abrirMenu(page: Page, tamanho: TamanhoIphone): Promise<void> {
  await abrirIos(page, 'principal', tamanho);
  await botao(page, 'Menu').click();
  await expect(page.getByRole('menu', { name: 'Menu' })).toBeVisible();
}

async function abrirContatos(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Seções' }).getByRole('button', { name: 'Contatos', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Contatos' })).toBeVisible();
}

async function naLigacao(page: Page, tamanho: TamanhoIphone, cenario: string, abrirPainel?: string): Promise<Locator> {
  await abrirIos(page, cenario, tamanho);
  if (abrirPainel) await botao(page, abrirPainel).click();
  return page.locator('body');
}

const TELAS: Array<[nome: string, abrir: AbrirTela]> = [
  [
    'Entrar',
    async (page, t) => {
      await abrirIos(page, 'entrar', t);
      return page.locator('body');
    },
  ],
  [
    'Editar conta',
    async (page, t) => {
      await abrirMenu(page, t);
      await page.getByRole('menuitem', { name: 'Editar conta' }).click();
      await expect(page.getByRole('heading', { name: 'Editar conta' })).toBeVisible();
      return page.locator('body');
    },
  ],
  [
    'Teclado',
    async (page, t) => {
      await abrirIos(page, 'principal', t);
      // Com uma sugestão da agenda.
      await page.getByRole('textbox', { name: 'Número' }).fill('988');
      await expect(page.locator('.suggest')).toHaveCount(1);
      return page.locator('body');
    },
  ],
  [
    'Recentes',
    async (page, t) => {
      await abrirIos(page, 'recentes', t);
      await expect(page.getByRole('main', { name: 'Recentes' })).toBeVisible();
      return page.locator('body');
    },
  ],
  [
    'Contatos',
    async (page, t) => {
      await abrirIos(page, 'principal', t);
      await abrirContatos(page);
      await expect(page.locator('main li.row').first()).toBeVisible();
      return page.locator('body');
    },
  ],
  [
    'Contatos sem a permissão',
    async (page, t) => {
      await abrirIos(page, 'principal', t, { agenda: 'negada' });
      await abrirContatos(page);
      await expect(botao(page, 'Permitir')).toBeVisible();
      return page.locator('body');
    },
  ],
  [
    'a escolha do número',
    async (page, t) => {
      await abrirIos(page, 'principal', t);
      await abrirContatos(page);
      await botao(page, 'Ligar para Ana Souza').click();
      const dialogo = page.getByRole('dialog', { name: 'Ana Souza' });
      await expect(dialogo).toBeVisible();
      return dialogo;
    },
  ],
  [
    'Configurações',
    async (page, t) => {
      await abrirIos(page, 'configuracoes', t);
      return page.locator('body');
    },
  ],
  [
    'Sobre',
    async (page, t) => {
      await abrirIos(page, 'sobre', t);
      return page.locator('body');
    },
  ],
  [
    'Avisos de licença',
    async (page, t) => {
      await abrirIos(page, 'sobre', t);
      await botao(page, 'Avisos de licença').click();
      await expect(page.getByRole('heading', { name: 'Avisos de licença', level: 1 })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Avisos de licença' })).toContainText('baresip');
      return page.locator('body');
    },
  ],
  [
    'o Menu aberto',
    async (page, t) => {
      await abrirMenu(page, t);
      return page.getByRole('menu', { name: 'Menu' });
    },
  ],
  [
    'a confirmação do Sair',
    async (page, t) => {
      await abrirMenu(page, t);
      await page.getByRole('menuitem', { name: 'Sair' }).click();
      const dialogo = page.getByRole('dialog', { name: 'Sair da conta?' });
      await expect(dialogo).toBeVisible();
      return dialogo;
    },
  ],
  ['a ligação', (page, t) => naLigacao(page, t, 'ligacao')],
  ['o teclado da ligação', (page, t) => naLigacao(page, t, 'ligacao', 'Teclado')],
  ['o Transferir', (page, t) => naLigacao(page, t, 'ligacao', 'Transferir')],
  ['a Nova ligação', (page, t) => naLigacao(page, t, 'ligacao', 'Nova ligação')],
  ['a segunda que toca', (page, t) => naLigacao(page, t, 'ligacao-segunda')],
  ['duas ligações', (page, t) => naLigacao(page, t, 'duas-ligacoes')],
  ['a consulta', (page, t) => naLigacao(page, t, 'consulta')],
  ['a conferência', (page, t) => naLigacao(page, t, 'conferencia')],
];

for (const tamanho of TAMANHOS_IPHONE) {
  test.describe(`os alvos de toque no iPhone ${tamanho.largura}×${tamanho.altura}`, () => {
    test.use(noIphone(tamanho));

    for (const [tela, abrir] of TELAS) {
      test(`${tela}: every tap target is at least 44×44 px`, async ({ page }) => {
        const raiz = await abrir(page, tamanho);
        const areas = await medirAreas(await alvosDeToque(raiz));
        expect(areas.length, `${tela}: algum alvo na tela`).toBeGreaterThan(0);
        const isentos = SEM_44.filter((s) => s.tela === tela).map((s) => s.alvo);
        expect(menoresQue44(areas.filter((a) => !isentos.includes(a.nome))), `${tela}: os alvos menores que 44×44 px`).toEqual([]);
        expect(areasQueSeCobrem(areas), `${tela}: as áreas do toque que se cobrem`).toEqual([]);
      });
    }
  });
}
