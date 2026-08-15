'use strict';

const { defineConfig, devices } = require('@playwright/test');

// A API sobe em NODE_ENV=test, ou seja, na porta e no banco de env.test. O E2E
// nunca toca no banco de desenvolvimento.
const API_URL = 'http://localhost:3001';
const WEB_URL = 'http://localhost:5173';

module.exports = defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.js',

  // Os testes compartilham o mesmo banco: em paralelo se atropelariam.
  workers: 1,
  fullyParallel: false,

  timeout: 30000,
  expect: { timeout: 5000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list']],

  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      command: 'node src/server.js',
      // Esperar pelo /api/health, que consulta o banco, garante API e Postgres
      // prontos — e nao apenas a porta aberta.
      url: `${API_URL}/api/health`,
      env: { NODE_ENV: 'test' },
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
    {
      command: 'npm run dev:web',
      url: WEB_URL,
      // Redireciona o proxy do Vite para a API de teste.
      env: { API_URL },
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
  ],
});
