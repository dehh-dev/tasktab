'use strict';

const { test, expect } = require('@playwright/test');
const { clearReports, createReport, addReceipts } = require('./helpers');
const { makeReceiptPdf } = require('../tests/fixtures/pdf');

test.beforeEach(async ({ request }) => {
  await clearReports(request);
});

async function openReview(page, request, title, buffer) {
  const report = await createReport(request, { title });
  await addReceipts(request, report.id, [buffer]);

  await page.goto('/');
  await page.getByRole('tab', { name: 'Prestacao de Contas' }).click();
  await page.getByRole('button', { name: title }).click();
  await page.locator('.list-item .link-button').first().click();
  await page.waitForSelector('.review__fields');

  return report;
}

test('recibo sem CNPJ: nome e cidade do papel, revisados a mao', async ({
  page,
  request,
}) => {
  // Sem CNPJ nao ha emitente para cadastrar — o caso do recibo manuscrito.
  // O que o papel diz chega preenchido, e a pessoa corrige.
  const report = await openReview(
    page,
    request,
    'Recibo sem CNPJ',
    await makeReceiptPdf({ cnpj: '' }),
  );

  const form = page.locator('form.form');
  await expect(form.getByLabel('Estabelecimento')).toHaveValue(
    'MERCEARIA FRANGUINHO NA PANELA LTDA',
  );
  await expect(form.getByLabel('Cidade')).toHaveValue('Abadiania/GO');

  await form.getByLabel('Estabelecimento').fill('Espetinho do Raimundinho');
  await form.getByLabel('Cidade').fill('Itapipoca/CE');
  await form.getByRole('button', { name: 'Confirmar' }).click();

  await expect(page.locator('.review__fields')).toHaveCount(0);
  await expect(page.locator('.list-item')).toContainText(
    'Espetinho do Raimundinho',
  );

  const response = await request.get(`/api/reports/${report.id}/receipts`);
  const [receipt] = (await response.json()).data;
  expect(receipt).toMatchObject({
    status: 'confirmed',
    issuer_name: 'Espetinho do Raimundinho',
    issuer_city: 'Itapipoca/CE',
  });
});

test('com emitente cadastrado, quem fala e o cadastro', async ({
  page,
  request,
}) => {
  await openReview(page, request, 'Cupom com CNPJ', await makeReceiptPdf());

  const form = page.locator('form.form');
  await expect(form.getByLabel('Estabelecimento')).toHaveCount(0);
  await expect(form.getByLabel('CNPJ')).toHaveCount(0);
});
