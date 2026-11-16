// As reuniões com link de ponta a ponta: o FreeSWITCH do nosso build, o agente de vídeo, o chat e o navegador com
// a câmera e o microfone falsos. O ambiente.ts sobe tudo uma vez só (o globalSetup), e os servidores são um só para
// todos os testes: um teste de cada vez, sem tentar de novo.
//
// Localmente: PLAYWRIGHT_BROWSERS_PATH aponta para o Chromium do @playwright/test 1.56.1 (o 1194).
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  globalSetup: './ambiente.ts',
  // O Playwright apaga esta pasta no começo; as saídas dos servidores ficam ao lado dela, em test-results/.
  outputDir: 'test-results/saida',
  timeout: 120_000,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
});
