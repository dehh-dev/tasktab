'use strict';

const { test, expect } = require('@playwright/test');
const { clearTasks } = require('./helpers');

test.beforeEach(async ({ request }) => {
  await clearTasks(request);
});

test('acusa titulo vazio sem chamar a API', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Nova tarefa' }).click();

  let requested = false;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/tasks')) {
      requested = true;
    }
  });

  await page.getByRole('button', { name: 'Criar tarefa' }).click();

  await expect(page.getByText('title e obrigatorio')).toBeVisible();
  expect(requested).toBe(false);

  // O campo se anuncia como invalido para leitores de tela.
  await expect(page.locator('form.form').getByLabel('Titulo')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
});

test('limpa o erro local assim que o campo e corrigido', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Nova tarefa' }).click();
  await page.getByRole('button', { name: 'Criar tarefa' }).click();

  await expect(page.getByText('title e obrigatorio')).toBeVisible();

  await page.locator('form.form').getByLabel('Titulo').fill('J');

  // A mensagem nao pode sobreviver a correcao: acusaria algo que ja e falso.
  await expect(page.getByText('title e obrigatorio')).toHaveCount(0);
  await expect(page.getByText('1/255 caracteres')).toBeVisible();
});

test('exibe o erro do servidor no campo certo e o descarta ao editar', async ({
  page,
}) => {
  await page.goto('/');

  // Excecao deliberada ao "sem mock" do projeto: hoje a validacao do cliente
  // cobre todas as regras do servidor, entao um 422 e inalcancavel pela
  // interface. Interceptar a resposta e a unica forma de exercitar o caminho,
  // que precisa continuar funcionando se as regras divergirem no futuro.
  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() !== 'POST') {
      return route.continue();
    }

    await route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        name: 'ValidationError',
        message: 'Falha de validacao.',
        action: 'Ajuste os campos indicados em details e tente de novo.',
        status_code: 422,
        details: [{ field: 'title', message: 'title ja esta em uso' }],
      }),
    });
  });

  await page.getByRole('button', { name: 'Nova tarefa' }).click();
  await page.locator('form.form').getByLabel('Titulo').fill('Titulo duplicado');
  await page.getByRole('button', { name: 'Criar tarefa' }).click();

  const fieldError = page.getByText('title ja esta em uso');

  await expect(fieldError).toBeVisible();
  // Erro por campo, nao alerta generico no topo.
  await expect(page.locator('.alert')).toHaveCount(0);
  // O que foi digitado e preservado.
  await expect(page.locator('form.form').getByLabel('Titulo')).toHaveValue(
    'Titulo duplicado',
  );

  await page
    .locator('form.form')
    .getByLabel('Titulo')
    .fill('Titulo duplicado!');

  await expect(fieldError).toHaveCount(0);
});
