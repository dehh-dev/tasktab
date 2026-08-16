'use strict';

const { test, expect } = require('@playwright/test');

test('troca de abas com clique e com teclado', async ({ page }) => {
  await page.goto('/');

  const tarefas = page.getByRole('tab', { name: 'Tarefas' });
  const contas = page.getByRole('tab', { name: 'Prestacao de Contas' });

  await expect(tarefas).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Tarefas' })).toBeVisible();

  await contas.click();

  await expect(contas).toHaveAttribute('aria-selected', 'true');
  await expect(tarefas).toHaveAttribute('aria-selected', 'false');
  await expect(
    page.getByRole('tabpanel', { name: 'Prestacao de Contas' }),
  ).toBeVisible();

  // O clique ja deixa o foco do DOM na aba clicada — e o ponto de partida
  // real de quem navega por teclado, nao um foco manual em aba nao
  // selecionada (essa nem e alcancavel por Tab: tabIndex e -1 nela).
  await expect(contas).toBeFocused();

  // Roving tabindex: a seta move o foco e ja seleciona a aba, com wrap-around.
  await page.keyboard.press('ArrowRight');

  await expect(tarefas).toHaveAttribute('aria-selected', 'true');
  await expect(tarefas).toBeFocused();

  await page.keyboard.press('ArrowLeft');

  await expect(contas).toHaveAttribute('aria-selected', 'true');
  await expect(contas).toBeFocused();
});

test('a aba de tarefas continua funcionando depois de visitar a outra', async ({
  page,
  request,
}) => {
  const response = await request.get('/api/tasks?limit=100');
  const { data } = await response.json();
  for (const task of data) {
    await request.delete(`/api/tasks/${task.id}`);
  }

  await page.goto('/');
  await page.getByRole('tab', { name: 'Prestacao de Contas' }).click();
  await page.getByRole('tab', { name: 'Tarefas' }).click();

  await page.getByRole('button', { name: 'Nova tarefa' }).click();
  await page
    .locator('form.form')
    .getByLabel('Titulo')
    .fill('Sobrevive a troca de aba');
  await page.getByRole('button', { name: 'Criar tarefa' }).click();

  await expect(page.getByText('Sobrevive a troca de aba')).toBeVisible();
});
