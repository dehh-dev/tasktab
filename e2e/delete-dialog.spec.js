'use strict';

const { test, expect } = require('@playwright/test');
const { clearTasks, createTask } = require('./helpers');

test.beforeEach(async ({ request }) => {
  await clearTasks(request);
  await createTask(request, { title: 'Tarefa descartavel' });
});

test('exige confirmacao antes de deletar', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Deletar' }).click();

  const dialog = page.getByRole('dialog');

  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Tarefa descartavel')).toBeVisible();
  // Nada foi removido enquanto o dialogo esta aberto.
  await expect(page.locator('.task')).toHaveCount(1);

  await dialog.getByRole('button', { name: 'Deletar' }).click();

  await expect(page.getByText('Nenhuma tarefa encontrada')).toBeVisible();
  await expect(page.locator('.task')).toHaveCount(0);
});

test('o foco comeca no botao seguro', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Deletar' }).click();

  const dialog = page.getByRole('dialog');

  // Um Enter acidental nao pode deletar: o foco inicial e o Cancelar.
  await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused();

  await page.keyboard.press('Enter');

  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.task')).toHaveCount(1);
});

test('Escape cancela sem deletar', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Deletar' }).click();

  await expect(page.getByRole('dialog')).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.task')).toHaveCount(1);
});

test('clique fora cancela sem deletar', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Deletar' }).click();

  // Canto superior esquerdo da tela: fora da caixa, sobre o overlay.
  await page.mouse.click(5, 5);

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.task')).toHaveCount(1);
});
