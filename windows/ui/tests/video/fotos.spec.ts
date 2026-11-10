// As fotos do vídeo para a aprovação do responsável (video etapa 2, Task 11): cada tela do vídeo nos dois temas e nos três
// tamanhos da janela (400×720, o Normal; 360×600, o Compacto; e 300×440, o Mínimo), em test-results/capturas/, com o nome
// video-<tela>-<largura>x<altura>-<tema>.png (o CI publica a pasta no artefato capturas-interface). Fora dos três tamanhos
// ficam o aviso do canto (380×222, e 380×430 com o porteiro; só no tema escuro, porque ele é sempre escuro) e o grande
// (1280×800) e a tela cheia (1920×1080), nos dois temas. Cada tela também passa pelo axe e pelo teclado: o Tab chega a
// todo controle e volta ao começo, e cada parada dele fica à vista. São testes de verificação (o código já existe).
import { expect, test, type Page } from '@playwright/test';
import { abrir, capturar, empurrar, entrarNaAdmin, mudarEstado, semViolacoesSerias } from '../helpers';
import { conferirOTeclado, daLargada } from '../teclado';
import { BRANCO, VERMELHO, quadro } from './video';

const TAMANHOS: Array<[number, number]> = [
  [400, 720],
  [360, 600],
  [300, 440],
];
const TEMAS = [
  ['light', 'claro'],
  ['dark', 'escuro'],
] as const;

const aba = (page: Page, nome: string) => page.getByRole('navigation', { name: 'Seções' }).getByRole('button', { name: nome });
const botao = (page: Page, nome: string) => page.getByRole('button', { name: nome, exact: true });

interface Tela {
  nome: string;
  /** Monta a tela, pronta para a foto. */
  preparar(page: Page): Promise<void>;
}

const TELAS: Tela[] = [
  {
    nome: 'teclado',
    async preparar(page) {
      await abrir(page, 'principal');
      await page.getByLabel('Número', { exact: true }).fill('2003');
      await expect(botao(page, 'Ligar com vídeo')).toBeEnabled();
    },
  },
  {
    nome: 'contatos',
    async preparar(page) {
      await abrir(page, 'principal');
      await aba(page, 'Contatos').click();
      await expect(page.getByRole('button', { name: /^Ligar com vídeo para / }).first()).toBeVisible();
    },
  },
  {
    // A primeira linha aberta, com o Ligar com vídeo.
    nome: 'recentes',
    async preparar(page) {
      await abrir(page, 'principal');
      await aba(page, 'Recentes').click();
      await page.locator('li.row-wrap .row-hit').first().click();
      await expect(page.getByRole('button', { name: /^Ligar com vídeo/ })).toHaveCount(1);
    },
  },
  {
    // O vídeo da Ana grande, com a sua imagem no canto.
    nome: 'ligacao',
    async preparar(page) {
      await abrir(page, 'video');
      await quadro(page, 'remoto', VERMELHO);
      await quadro(page, 'local', BRANCO);
    },
  },
  {
    nome: 'voz-com-camera',
    async preparar(page) {
      await abrir(page, 'video-voz-camera');
      await quadro(page, 'local', BRANCO);
    },
  },
  {
    // A câmera desligada e o aviso de 5 s.
    nome: 'aviso-da-camera',
    async preparar(page) {
      await abrir(page, 'video');
      await quadro(page, 'remoto', VERMELHO);
      await mudarEstado(page, (s) => ({
        ...s,
        ligacao: { ...s.ligacao, top: { ...s.ligacao.top, video: { ...s.ligacao.top.video, camera: false } } },
      }));
      await empurrar(page, { v: 1, type: 'toast', texto: 'A câmera foi desconectada.' });
      await expect(page.locator('.toast').getByText('A câmera foi desconectada.', { exact: true })).toBeVisible();
      await expect(botao(page, 'Ligar a câmera')).toBeVisible();
    },
  },
  {
    nome: 'tocando',
    async preparar(page) {
      await abrir(page, 'video-tocando');
      await expect(botao(page, 'Atender com vídeo')).toBeVisible();
    },
  },
  {
    nome: 'tocando-porteiro',
    async preparar(page) {
      // Na janela principal, a imagem do porteiro que toca é a vista `remoto` (a `porteiro` é só do aviso do canto).
      await abrir(page, 'video-porteiro');
      await quadro(page, 'remoto', VERMELHO);
      await expect(page.getByRole('img', { name: 'Vídeo de Portaria', exact: true })).toBeVisible();
    },
  },
  {
    // O teste da câmera, com a sua imagem.
    nome: 'configuracoes',
    async preparar(page) {
      await abrir(page, 'configuracoes');
      await botao(page, 'Testar a câmera').click();
      await quadro(page, 'local', BRANCO);
      await expect(botao(page, 'Parar o teste')).toBeVisible();
    },
  },
  {
    nome: 'configuracoes-sem-camera',
    async preparar(page) {
      await abrir(page, 'sem-camera');
      await expect(page.getByLabel('Câmera', { exact: true }).locator('option')).toHaveText(['Nenhuma câmera encontrada.']);
    },
  },
  {
    nome: 'adm-video',
    async preparar(page) {
      await abrir(page, 'principal');
      await entrarNaAdmin(page);
      await page.getByRole('switch', { name: 'VP8', exact: true }).scrollIntoViewIfNeeded();
      await expect(page.getByRole('status').filter({ hasText: 'H.264 da Cisco: instalado' })).toBeVisible();
    },
  },
  {
    nome: 'adm-video-falhou',
    async preparar(page) {
      await abrir(page, 'principal');
      await entrarNaAdmin(page);
      await mudarEstado(page, (s) => ({ ...s, video: { ...s.video, h264: { ...s.video.h264, situacao: 'falhou' } } }));
      const situacao = page.getByRole('status').filter({ hasText: 'H.264 da Cisco: não foi possível baixar' });
      await situacao.scrollIntoViewIfNeeded();
      await expect(situacao).toBeVisible();
      await expect(botao(page, 'Tentar de novo')).toBeVisible();
    },
  },
  {
    nome: 'licencas',
    async preparar(page) {
      await abrir(page, 'sobre');
      await botao(page, 'Avisos de licença').click();
      await expect(page.getByRole('heading', { name: 'Avisos de licença', level: 1 })).toBeVisible();
    },
  },
];

for (const [largura, altura] of TAMANHOS) {
  for (const [esquema, tema] of TEMAS) {
    test.describe(`as fotos do vídeo em ${largura}×${altura} (${tema})`, () => {
      test.use({ viewport: { width: largura, height: altura }, colorScheme: esquema });

      for (const tela of TELAS) {
        test(`video-${tela.nome}: the photo, no serious violations, and Tab reaches every control without losing the focus`, async ({ page }) => {
          await tela.preparar(page);
          await semViolacoesSerias(page);
          await capturar(page, `video-${tela.nome}-${largura}x${altura}`, tema);
          await daLargada(page);
          await conferirOTeclado(page);
        });
      }
    });
  }
}

// O aviso do canto: sempre escuro, nos tamanhos que o executável dá a ele.
test.describe('as fotos do aviso do canto (escuro)', () => {
  test.use({ colorScheme: 'dark' });

  test('video-aviso: the photo, no serious violations, and Tab reaches every control', async ({ page }) => {
    await page.setViewportSize({ width: 380, height: 222 });
    await abrir(page, 'video-tocando', 'aviso.html');
    await expect(botao(page, 'Atender com vídeo')).toBeVisible();
    await semViolacoesSerias(page);
    await capturar(page, 'video-aviso-380x222', 'escuro');
    await daLargada(page);
          await conferirOTeclado(page);
  });

  test('video-aviso-porteiro: the photo, no serious violations, and Tab reaches every control', async ({ page }) => {
    await page.setViewportSize({ width: 380, height: 430 });
    await abrir(page, 'video-porteiro', 'aviso.html');
    await quadro(page, 'porteiro', VERMELHO);
    await expect(page.getByRole('img', { name: 'Vídeo de Portaria', exact: true })).toBeVisible();
    await semViolacoesSerias(page);
    await capturar(page, 'video-aviso-porteiro-380x430', 'escuro');
    await daLargada(page);
          await conferirOTeclado(page);
  });
});

// O grande e a tela cheia, nos dois temas.
for (const [esquema, tema] of TEMAS) {
  test.describe(`as fotos do grande e da tela cheia (${tema})`, () => {
    test.use({ viewport: { width: 1280, height: 800 }, colorScheme: esquema });

    test('video-grande: the photo, no serious violations, and Tab reaches every control', async ({ page }) => {
      await abrir(page, 'video-grande');
      await quadro(page, 'remoto', VERMELHO);
      await quadro(page, 'local', BRANCO);
      await semViolacoesSerias(page);
      await capturar(page, 'video-grande-1280x800', tema);
      await daLargada(page);
          await conferirOTeclado(page);
    });

    test('video-tela-cheia: the photo, no serious violations, and Tab reaches every control', async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await abrir(page, 'video-grande');
      await botao(page, 'Tela cheia').click();
      await expect(botao(page, 'Sair da tela cheia')).toBeVisible();
      await quadro(page, 'remoto', VERMELHO);
      await quadro(page, 'local', BRANCO);
      await semViolacoesSerias(page);
      await capturar(page, 'video-tela-cheia-1920x1080', tema);
      await daLargada(page);
          await conferirOTeclado(page);
    });
  });
}
