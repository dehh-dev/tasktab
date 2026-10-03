'use strict';

const { test, expect } = require('@playwright/test');
const { clearReports, createReport } = require('./helpers');

test.beforeEach(async ({ request }) => {
  await clearReports(request);
});

async function openReport(page, report) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Prestacao de Contas' }).click();
  await page.getByRole('button', { name: report.title }).click();
}

test('corrige titulo, adiantamento e cidade principal pela tela', async ({
  page,
  request,
}) => {
  // Criado sem adiantamento: "nao informado", e nao zero.
  const report = await createReport(request, { title: 'Viagem a corrigir' });

  await openReport(page, report);
  const dados = page.getByLabel('Dados do relatorio');
  await expect(dados).toContainText('Adiantamento nao informado');

  await page.getByRole('button', { name: 'Editar relatorio' }).click();

  const form = page.locator('form.form');
  await expect(form.getByLabel('Titulo')).toHaveValue('Viagem a corrigir');
  await form.getByLabel('Titulo').fill('Viagem a Itapipoca');
  await form.getByLabel('Adiantamento recebido (R$)').fill('1.500,00');
  await form.getByLabel('Cidade principal').fill('Itapipoca/CE');
  await form.getByRole('button', { name: 'Salvar relatorio' }).click();

  await expect(dados).toContainText('Viagem a Itapipoca');
  await expect(dados).toContainText('Adiantamento: R$ 1.500,00');
  await expect(dados).toContainText('Cidade principal: Itapipoca/CE');
});

test('zero e "sem adiantamento", e nao "nao informado"', async ({
  page,
  request,
}) => {
  const report = await createReport(request, {
    title: 'Viagem sem adiantamento',
    advance_cents: 0,
  });

  await openReport(page, report);

  await expect(page.getByLabel('Dados do relatorio')).toContainText(
    'Sem adiantamento',
  );
});

test('relatorio fechado nao oferece edicao', async ({ page, request }) => {
  const report = await createReport(request, { title: 'Viagem fechada' });
  await request.patch(`/api/reports/${report.id}`, {
    data: { status: 'closed' },
  });

  await openReport(page, report);

  await expect(page.getByText('Fechado', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Editar relatorio' }),
  ).toHaveCount(0);
});
