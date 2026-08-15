'use strict';

const { test, expect } = require('@playwright/test');
const { clearTasks, createTask } = require('./helpers');

test.beforeEach(async ({ request }) => {
  await clearTasks(request);
});

test('mostra o estado vazio quando nao ha tarefas', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'tasktab' })).toBeVisible();
  await expect(page.getByText('Nenhuma tarefa encontrada')).toBeVisible();
  await expect(page.getByText('0 tarefas')).toBeVisible();
});

test('cria uma tarefa e a exibe na lista', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Nova tarefa' }).click();

  // Escopado ao formulario: "Status" tambem casaria com o aria-label do grupo
  // de filtros, e "Cancelar" existe no formulario e no dialogo.
  const form = page.locator('form.form');

  await form.getByLabel('Titulo').fill('Revisar o PR');
  await form.getByLabel('Descricao').fill('Conferir os testes e o lint.');
  await form.getByLabel('Status').selectOption('in_progress');
  await form.getByLabel('Prazo').fill('2026-12-31');
  await form.getByRole('button', { name: 'Criar tarefa' }).click();

  const task = page.locator('.task').filter({ hasText: 'Revisar o PR' });

  await expect(task).toBeVisible();
  await expect(task.getByText('Conferir os testes e o lint.')).toBeVisible();
  await expect(task.getByText('Em andamento')).toBeVisible();
  // A data e formatada sem passar por Date, entao nao pode "andar" um dia.
  await expect(task.getByText('Prazo: 31/12/2026')).toBeVisible();

  // O formulario fecha e a contagem vem do meta da API.
  await expect(page.getByRole('button', { name: 'Criar tarefa' })).toHaveCount(
    0,
  );
  await expect(page.getByText('1 tarefa', { exact: true })).toBeVisible();
});

test('edita uma tarefa a partir dos valores atuais', async ({
  page,
  request,
}) => {
  await createTask(request, {
    title: 'Titulo antigo',
    description: 'Descricao antiga',
    status: 'pending',
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Editar' }).click();

  const form = page.locator('form.form');

  // O formulario abre preenchido com o que ja existe.
  await expect(form.getByLabel('Titulo')).toHaveValue('Titulo antigo');
  await expect(form.getByLabel('Descricao')).toHaveValue('Descricao antiga');
  await expect(form.getByLabel('Status')).toHaveValue('pending');

  await form.getByLabel('Titulo').fill('Titulo novo');
  await form.getByLabel('Status').selectOption('done');
  await form.getByRole('button', { name: 'Salvar alteracoes' }).click();

  const task = page.locator('.task').filter({ hasText: 'Titulo novo' });

  await expect(task).toBeVisible();
  await expect(task.getByText('Concluida')).toBeVisible();
  await expect(page.getByText('Titulo antigo')).toHaveCount(0);
});

test('filtra por status e atualiza a contagem', async ({ page, request }) => {
  await createTask(request, { title: 'Uma pendente', status: 'pending' });
  await createTask(request, { title: 'Uma concluida', status: 'done' });

  await page.goto('/');
  await expect(page.getByText('2 tarefas')).toBeVisible();

  await page.getByRole('button', { name: 'Concluida' }).click();

  await expect(page.getByText('Uma concluida')).toBeVisible();
  await expect(page.getByText('Uma pendente')).toHaveCount(0);
  await expect(page.getByText('1 tarefa', { exact: true })).toBeVisible();

  // O filtro ativo precisa se anunciar para leitores de tela.
  await expect(page.getByRole('button', { name: 'Concluida' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: 'Todas' }).click();
  await expect(page.getByText('2 tarefas')).toBeVisible();
});
