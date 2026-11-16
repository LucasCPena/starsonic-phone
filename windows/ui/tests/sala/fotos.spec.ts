// As fotos da sala para a aprovação do responsável (video etapa 3b, Task 8): cada tela da sala nos dois temas e nos três
// tamanhos da janela (400×720, o Normal; 360×600, o Compacto; e 300×440, o Mínimo), em test-results/capturas/, com o nome
// sala-<tela>-<largura>x<altura>-<tema>.png (o CI publica a pasta no artefato capturas-interface). Fora dos três tamanhos
// ficam o grande e o grande com o painel de adicionar (1280×800, o ?fake=sala-grande) e a tela cheia (1920×1080, a sala
// cheia), nos dois temas. Cada tela também passa pelo axe e pelo teclado: o Tab chega a todo controle e volta ao começo, e
// cada parada dele fica à vista. São testes de verificação (o código já existe), como o tests/video/fotos.spec.ts.
import { expect, test, type Page } from '@playwright/test';
import { abrir, capturar, semViolacoesSerias } from '../helpers';
import { conferirOTeclado, daLargada } from '../teclado';
import { AZUL, mosaico, mosaicoDaSala, quadroDe } from './sala';
import { BRANCO, VERMELHO, quadro } from '../video/video';

const TAMANHOS: Array<[number, number]> = [
  [400, 720],
  [360, 600],
  [300, 440],
];
const TEMAS = [
  ['light', 'claro'],
  ['dark', 'escuro'],
] as const;

const botao = (page: Page, nome: string) => page.getByRole('button', { name: nome, exact: true });
const campo = (page: Page) => page.getByRole('combobox', { name: 'Adicionar à sala', exact: true });

interface Tela {
  nome: string;
  /** Monta a tela, pronta para a foto. */
  preparar(page: Page): Promise<void>;
}

/** O mosaico da sala de agora e a sua imagem no `local` (os três cenários da sala com a câmera ligada). */
async function mosaicoEImagem(page: Page): Promise<void> {
  await mosaicoDaSala(page);
  await quadro(page, 'local', BRANCO);
}

const TELAS: Tela[] = [
  {
    // O vídeo da Ana, com a sua imagem no canto, antes do Adicionar pessoa.
    nome: 'videochamada',
    async preparar(page) {
      await abrir(page, 'video');
      await quadro(page, 'remoto', VERMELHO);
      await quadro(page, 'local', BRANCO);
      await expect(botao(page, 'Adicionar pessoa')).toBeEnabled();
    },
  },
  {
    // O painel de adicionar, com "car" e a seta para baixo (o Carlos na lista).
    nome: 'adicionar',
    async preparar(page) {
      await abrir(page, 'video');
      await quadro(page, 'remoto', VERMELHO);
      await quadro(page, 'local', BRANCO);
      await botao(page, 'Adicionar pessoa').click();
      await expect(campo(page)).toBeFocused();
      await campo(page).fill('car');
      await campo(page).press('ArrowDown');
      await expect(campo(page)).toHaveAttribute('aria-expanded', 'true');
      // Com o painel aberto o vídeo da Ana sai da tela e a sua imagem vai para o canto de baixo à direita: o quadro vai à
      // vista nova.
      await quadro(page, 'local', BRANCO);
    },
  },
  {
    nome: 'tres',
    async preparar(page) {
      await abrir(page, 'sala');
      await mosaicoEImagem(page);
    },
  },
  {
    // O foco no Tirar da sala da Ana, o contorno ciano do quadro dela.
    nome: 'estados',
    async preparar(page) {
      await abrir(page, 'sala-estados');
      await mosaicoEImagem(page);
      const tirar = quadroDe(page, 'Ana Souza').getByRole('button', { name: 'Tirar da sala', exact: true });
      await tirar.focus();
      await expect(tirar).toBeFocused();
    },
  },
  {
    nome: 'cheia',
    async preparar(page) {
      await abrir(page, 'sala-cheia');
      await mosaicoEImagem(page);
      await expect(botao(page, 'Adicionar pessoa')).toBeDisabled();
    },
  },
  {
    // A pergunta do Desligar.
    nome: 'encerrar',
    async preparar(page) {
      await abrir(page, 'sala');
      await mosaicoEImagem(page);
      await botao(page, 'Desligar').click();
      await expect(page.getByRole('alertdialog', { name: 'Encerrar a sala para todos?' })).toBeVisible();
    },
  },
  {
    // O Roberto toca por cima da sala.
    nome: 'ligacao-de-fora',
    async preparar(page) {
      await abrir(page, 'sala-ligacao-de-fora');
      await mosaicoDaSala(page);
      await expect(page.getByRole('alert').filter({ hasText: 'Ligação de Roberto Lima' })).toBeVisible();
    },
  },
  {
    // Fora da sala: a faixa e o Roberto, só com a voz.
    nome: 'fora',
    async preparar(page) {
      await abrir(page, 'sala-fora');
      await expect(page.getByRole('region', { name: 'Você está fora da sala', exact: true })).toBeVisible();
      await expect(botao(page, 'Voltar para a sala')).toBeVisible();
    },
  },
  {
    // De volta à sala, com o Roberto em espera.
    nome: 'de-volta',
    async preparar(page) {
      await abrir(page, 'sala-de-volta');
      await mosaicoDaSala(page);
      await expect(page.getByRole('group', { name: 'Mosaico da sala', exact: true })).toBeVisible();
      await expect(page.getByText('Roberto Lima', { exact: true }).first()).toBeVisible();
    },
  },
  {
    // O que um convidado vê: uma videochamada comum, com o mosaico de dois da Recepção (a metade da esquerda vermelha e a
    // da direita azul).
    nome: 'convidado',
    async preparar(page) {
      await abrir(page, 'sala-convidado');
      await mosaico(
        page,
        [
          { quadro: { x: 0, y: 0, largura: 0.5, altura: 1 }, cor: VERMELHO },
          { quadro: { x: 0.5, y: 0, largura: 0.5, altura: 1 }, cor: AZUL },
        ],
        640,
        480,
      );
      await expect(page.getByRole('group', { name: 'Mosaico da sala', exact: true })).toHaveCount(0);
    },
  },
];

for (const [largura, altura] of TAMANHOS) {
  for (const [esquema, tema] of TEMAS) {
    test.describe(`as fotos da sala em ${largura}×${altura} (${tema})`, () => {
      test.use({ viewport: { width: largura, height: altura }, colorScheme: esquema });

      for (const tela of TELAS) {
        test(`sala-${tela.nome}: the photo, no serious violations, and Tab reaches every control without losing the focus`, async ({ page }) => {
          await tela.preparar(page);
          await semViolacoesSerias(page);
          await capturar(page, `sala-${tela.nome}-${largura}x${altura}`, tema);
          await daLargada(page);
          await conferirOTeclado(page);
        });
      }
    });
  }
}

// O grande, o grande com o painel de adicionar e a tela cheia, nos dois temas.
for (const [esquema, tema] of TEMAS) {
  test.describe(`as fotos da sala no grande e na tela cheia (${tema})`, () => {
    test.use({ viewport: { width: 1280, height: 800 }, colorScheme: esquema });

    test('sala-grande: the photo, no serious violations, and Tab reaches every control', async ({ page }) => {
      await abrir(page, 'sala-grande');
      await mosaicoEImagem(page);
      await semViolacoesSerias(page);
      await capturar(page, 'sala-grande-1280x800', tema);
      await daLargada(page);
      await conferirOTeclado(page);
    });

    test('sala-grande-adicionar: the photo, no serious violations, and Tab reaches every control', async ({ page }) => {
      await abrir(page, 'sala-grande');
      await mosaicoEImagem(page);
      await botao(page, 'Adicionar pessoa').click();
      await expect(campo(page)).toBeFocused();
      await mosaicoDaSala(page);
      await semViolacoesSerias(page);
      await capturar(page, 'sala-grande-adicionar-1280x800', tema);
      await daLargada(page);
      await conferirOTeclado(page);
    });

    test('sala-tela-cheia: the photo, no serious violations, and Tab reaches every control', async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await abrir(page, 'sala-cheia');
      await botao(page, 'Abrir grande').click();
      await expect(botao(page, 'Tela cheia')).toBeVisible();
      await botao(page, 'Tela cheia').click();
      await expect(botao(page, 'Sair da tela cheia')).toBeVisible();
      await mosaicoEImagem(page);
      await semViolacoesSerias(page);
      await capturar(page, 'sala-tela-cheia-1920x1080', tema);
      await daLargada(page);
      await conferirOTeclado(page);
    });
  });
}
