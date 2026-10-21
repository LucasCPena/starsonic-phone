// Testes da interface no Chromium do Linux, contra a ponte falsa (?fake=<cenario>).
// Localmente: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers (o Chromium 1194 do @playwright/test 1.56.1).
import { defineConfig, devices } from '@playwright/test';

const PORTA = 4178;

export default defineConfig({
  testDir: 'tests',
  outputDir: 'test-results/saida',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${PORTA}`,
    // A janela do app: 400×720 em 100% de escala (a barra de título de 32 px faz parte da página).
    viewport: { width: 400, height: 720 },
    deviceScaleFactor: 1,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `node tests/serve.mjs ${PORTA}`,
    url: `http://127.0.0.1:${PORTA}/index.html`,
    reuseExistingServer: !process.env.CI,
  },
});
