'use strict';

const { test, expect } = require('@playwright/test');
const { clearReports, createReport, addReceipts } = require('./helpers');
const { makeReceiptPdf } = require('../tests/fixtures/pdf');

const CHAVE = '52260626048802000165650010001631601303284889';

test.beforeEach(async ({ request }) => {
  await clearReports(request);
});

/**
 * Cupom com camada de texto e sem QR: a extracao le data e valor, e a chave
 * fica por digitar — o caso do QR degradado demais no escaneamento.
 */
async function openReviewWithoutKey(page, request, title) {
  const report = await createReport(request, { title });
  await addReceipts(request, report.id, [
    await makeReceiptPdf({ total: '37,60', date: '19/06/2026' }),
  ]);

  await page.goto('/');
  await page.getByRole('tab', { name: 'Prestacao de Contas' }).click();
  await page.getByRole('button', { name: title }).click();
  await page.locator('.list-item .link-button').first().click();
  await page.waitForSelector('.review__fields');

  return report;
}

test('chave que nao fecha o DV volta no campo, com o que foi digitado', async ({
  page,
  request,
}) => {
  await openReviewWithoutKey(page, request, 'Chave digitada errada');
  const quebrada = `${CHAVE.slice(0, 43)}${(Number(CHAVE[43]) + 1) % 10}`;

  const form = page.locator('form.form');
  const field = form.getByLabel('Chave de acesso');
  await field.fill(quebrada);
  await form.getByRole('button', { name: 'Confirmar' }).click();

  await expect(
    form.getByText('access_key nao fecha o digito verificador'),
  ).toBeVisible();
  await expect(field).toHaveValue(quebrada);
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  // Nada foi confirmado: a revisao continua aberta no mesmo comprovante.
  await expect(page.locator('.review__fields')).toBeVisible();
});

test('chave digitada como impressa confirma o comprovante', async ({
  page,
  request,
}) => {
  const report = await openReviewWithoutKey(
    page,
    request,
    'Chave digitada certa',
  );

  const form = page.locator('form.form');
  await form
    .getByLabel('Chave de acesso')
    .fill(CHAVE.match(/.{1,4}/g).join(' '));
  await form.getByRole('button', { name: 'Confirmar' }).click();

  // Era o unico pendente: a revisao fecha e a lista mostra o confirmado.
  await expect(page.locator('.review__fields')).toHaveCount(0);
  await expect(page.locator('.list-item')).toContainText('Confirmado');

  const response = await request.get(`/api/reports/${report.id}/receipts`);
  const [receipt] = (await response.json()).data;
  expect(receipt.access_key).toBe(CHAVE);
});
