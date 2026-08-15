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

test('prende o foco dentro do dialogo', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Deletar' }).click();

  const dialog = page.getByRole('dialog');

  // Tab de sobra para dar a volta no ciclo mais de uma vez. O foco pode passar
  // pelo <body> no ponto de virada — isso e normal em modal — mas nunca pode
  // pousar num controle da pagina atras.
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');

    const escaped = await dialog.evaluate((node) => {
      const active = document.activeElement;
      if (!active || active === document.body) {
        return false;
      }
      return !node.contains(active);
    });

    expect(escaped).toBe(false);
  }
});

test('devolve o foco ao botao que abriu', async ({ page }) => {
  await page.goto('/');

  const trigger = page.getByRole('button', { name: 'Deletar' });
  await trigger.click();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Quem navega por teclado precisa voltar de onde saiu.
  await expect(trigger).toBeFocused();
});

test('clique fora cancela sem deletar', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Deletar' }).click();

  // Canto superior esquerdo da tela: fora da caixa, sobre o overlay.
  await page.mouse.click(5, 5);

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.task')).toHaveCount(1);
});
