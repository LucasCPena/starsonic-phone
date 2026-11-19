// Os testes das telas da página da reunião, no Chromium, contra o chat de verdade no modo de teste (chat.ts) e a rede
// falsa de cada teste (rede-falsa.ts). A câmera e o microfone são os falsos do Chromium, com a permissão dada.
//
// Localmente: PLAYWRIGHT_BROWSERS_PATH aponta para o Chromium do @playwright/test 1.56.1 (o 1194).
import { defineConfig, devices } from '@playwright/test';
import { CHAT } from './chat';

export default defineConfig({
  testDir: 'testes',
  testMatch: '*.spec.ts',
  globalSetup: './chat.ts',
  // O Playwright apaga esta pasta no começo; a saída do chat fica ao lado dela, em test-results/.
  outputDir: 'test-results/saida',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: CHAT,
    // O tamanho do quadro aprovado no PC.
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    permissions: ['camera', 'microphone'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
