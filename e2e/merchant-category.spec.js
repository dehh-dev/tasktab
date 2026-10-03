'use strict';

const { test, expect } = require('@playwright/test');
const { clearReports, createReport, addReceipts } = require('./helpers');
const { makeReceiptPdf } = require('../tests/fixtures/pdf');

const CNPJ = '26048802000165';

test.beforeEach(async ({ request }) => {
  await clearReports(request);
});

test('confirmar com a caixa marcada grava a categoria no emitente', async ({
  page,
  request,
}) => {
  const report = await createReport(request, { title: 'Categoria' });
  await addReceipts(request, report.id, [await makeReceiptPdf()]);

  // O `clearReports` devolve os emitentes a `nao_classificado`.
  const lookup = await request.get(`/api/merchants/by-cnpj/${CNPJ}`);
  const merchant = (await lookup.json()).data;

  await page.goto('/');
  await page.getByRole('tab', { name: 'Prestacao de Contas' }).click();
  await page.getByRole('button', { name: report.title }).click();
  await page.locator('.list-item .link-button').first().click();

  const form = page.locator('form.form');
  await form.locator('#review-category').selectOption('transporte');

  // Emitente sem categoria: a caixa ja vem marcada.
  const apply = form.getByLabel(/Usar esta categoria nos proximos cupons/);
  await expect(apply).toBeChecked();

  await form.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.locator('.review__fields')).toHaveCount(0);

  const after = await request.get(`/api/merchants/${merchant.id}`);
  expect((await after.json()).data.default_category).toBe('transporte');
});
