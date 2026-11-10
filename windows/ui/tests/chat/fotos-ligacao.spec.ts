// As fotos do chat com a ligação para a aprovação do responsável (video etapa 2, Task 11), contra o servidor do chat de
// teste: a conversa com o Ligar com vídeo e a conversa com a faixa da ligação, nos dois temas e nos três tamanhos da janela
// (400×720, 360×600 e 300×440), e o grande-chat (a conversa ao lado do vídeo, 1280×800). Em test-results/capturas/, com o
// nome video-<tela>-<largura>x<altura>-<tema>.png. Cada tela passa pelo axe e pelo teclado. Cada teste cria a própria empresa.
import { expect, test, type Page } from '@playwright/test';
import { capturar, mudarEstado, semViolacoesSerias } from '../helpers';
import { conferirOTeclado, daLargada } from '../teclado';
import { BRANCO, VERMELHO, quadro } from '../video/video';
import { abrirAConversa, abrirNoChat, esperarOsEventos } from './abrir';
import { empresaComPessoas } from './servidor';

// O CSP da página só deixa falar com o endereço do chat de verdade; o servidor de teste fica no 127.0.0.1:4180.
test.use({ bypassCSP: true });

const EMPRESA = 'ACME Comércio Ltda';
const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
const ANA = { ramal: '2003', nome: 'Ana Souza' };
const COM_VIDEO = { oferece: true, ativo: true, imagem: true, camera: true, cedo: false };

const TAMANHOS: Array<[number, number]> = [
  [400, 720],
  [360, 600],
  [300, 440],
];
const TEMAS = [
  ['light', 'claro'],
  ['dark', 'escuro'],
] as const;

/** A ligação com a Ana, com vídeo, recebida e atendida há 5 s. */
const ligacaoComAAna = {
  top: { id: 51, number: ANA.ramal, name: ANA.nome, incoming: true, phase: 'active', activeSinceMs: 0, held: false, video: COM_VIDEO },
  second: null,
  secondKind: 'none',
  muted: false,
  conference: false,
  conferenceSinceMs: 0,
  consulting: false,
  colleagueActive: false,
};

/** A empresa com a Recepção e a Ana, uma conversa a dois com mensagens, e a conversa aberta. */
async function naConversa(page: Page, abrirAConversaDaAna = true): Promise<void> {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [eu, ana] = pessoas;
  const dupla = await ana.api.criarDupla(eu.pessoa.id);
  await ana.api.enviarTexto(dupla, 'Bom dia. Me liga quando puder?');
  await eu.api.enviarTexto(dupla, 'Ligo já, já. Pode ser com vídeo?');
  await abrirNoChat(page, { chave: eu.chave, ...RECEPCAO });
  await esperarOsEventos(page);
  if (!abrirAConversaDaAna) return;
  await abrirAConversa(page, 'Ana Souza');
  await expect(page.getByRole('log', { name: 'Mensagens com Ana Souza' }).locator('.balao-texto')).toHaveCount(2);
}

/** Da conversa para a ligação com a Ana, com a conversa aberta embaixo da faixa (o Chat da tela da ligação). */
async function naLigacaoComAConversa(page: Page): Promise<void> {
  await naConversa(page, false);
  await mudarEstado(page, (s) => ({ ...s, ligacao: { ...ligacaoComAAna, top: { ...ligacaoComAAna.top, activeSinceMs: Date.now() - 5_000 } } }));
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.locator('.faixa-ligacao')).toBeVisible();
  await expect(page.getByRole('log', { name: 'Mensagens com Ana Souza' })).toBeVisible();
  await quadro(page, 'remoto', VERMELHO);
  await quadro(page, 'local', BRANCO);
}

for (const [largura, altura] of TAMANHOS) {
  for (const [esquema, tema] of TEMAS) {
    test.describe(`as fotos do chat com vídeo em ${largura}×${altura} (${tema})`, () => {
      test.use({ viewport: { width: largura, height: altura }, colorScheme: esquema });

      test('video-conversa: the photo, no serious violations, and Tab reaches every control', async ({ page }) => {
        await naConversa(page);
        await expect(page.getByRole('button', { name: 'Ligar com vídeo para Ana Souza, ramal 2003' })).toBeVisible();
        await semViolacoesSerias(page);
        await capturar(page, `video-conversa-${largura}x${altura}`, tema);
        await daLargada(page);
        await conferirOTeclado(page);
      });

      test('video-conversa-na-ligacao: the photo, no serious violations, and Tab reaches every control', async ({ page }) => {
        await naLigacaoComAConversa(page);
        await semViolacoesSerias(page);
        await capturar(page, `video-conversa-na-ligacao-${largura}x${altura}`, tema);
        await daLargada(page);
        await conferirOTeclado(page);
      });
    });
  }
}

// O grande com a conversa ao lado: o Chat da ligação, com a janela grande.
for (const [esquema, tema] of TEMAS) {
  test.describe(`a foto do grande com o chat (${tema})`, () => {
    test.use({ viewport: { width: 1280, height: 800 }, colorScheme: esquema });

    test('video-grande-chat: the photo, no serious violations, and Tab reaches every control', async ({ page }) => {
      await naConversa(page, false);
      await mudarEstado(page, (s) => ({
        ...s,
        video: { ...s.video, janela: 'grande' },
        ligacao: { ...ligacaoComAAna, top: { ...ligacaoComAAna.top, activeSinceMs: Date.now() - 5_000 } },
      }));
      await page.locator('.grande-barra').getByRole('button', { name: 'Chat', exact: true }).click();
      await expect(page.getByRole('log', { name: 'Mensagens com Ana Souza' })).toBeVisible();
      await quadro(page, 'remoto', VERMELHO);
      await quadro(page, 'local', BRANCO);
      await semViolacoesSerias(page);
      await capturar(page, 'video-grande-chat-1280x800', tema);
      await daLargada(page);
        await conferirOTeclado(page);
    });
  });
}
