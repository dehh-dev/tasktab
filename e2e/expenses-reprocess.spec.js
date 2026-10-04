'use strict';

const { test, expect } = require('@playwright/test');
const { clearReports, createReport, addReceipts } = require('./helpers');
const { makeReceiptPdf } = require('../tests/fixtures/pdf');

test.beforeEach(async ({ request }) => {
  await clearReports(request);
});

/** Um comprovante conferido a mao: valor corrigido e confirmado. */
async function openWithConfirmed(page, request, title) {
  const report = await createReport(request, { title });
  const [receipt] = await addReceipts(request, report.id, [
    await makeReceiptPdf({ total: '37,60' }),
  ]);

  await request.patch(`/api/receipts/${receipt.id}`, {
    data: { amount_cents: 3670, category: 'alimentacao', status: 'confirmed' },
  });

  await page.goto('/');
  await page.getByRole('tab', { name: 'Prestacao de Contas' }).click();
  await page.getByRole('button', { name: title }).click();
  await expect(page.locator('.list-item')).toContainText('Confirmado');
}

test('reprocessar o que ja foi conferido pede confirmacao antes', async ({
  page,
  request,
}) => {
  await openWithConfirmed(page, request, 'Reprocessar conferido');

  await page
    .locator('.list-item')
    .getByRole('button', { name: 'Reprocessar' })
    .click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Reprocessar comprovante conferido?');
  // O dialogo diz o que se perde, e de qual comprovante.
  await expect(dialog).toContainText('serao substituidos');
  await expect(dialog).toContainText('R$ 36,70');

  await dialog.getByRole('button', { name: 'Cancelar' }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.list-item')).toContainText('Confirmado');
  await expect(page.locator('.list-item')).toContainText('R$ 36,70');
});

test('confirmado o descarte, volta a revisao com o que a extracao ler', async ({
  page,
  request,
}) => {
  await openWithConfirmed(page, request, 'Descartar conferencia');

  await page
    .locator('.list-item')
    .getByRole('button', { name: 'Reprocessar' })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Reprocessar' })
    .click();

  const row = page.locator('.list-item');
  await expect(row).toContainText('Aguardando revisao', { timeout: 15000 });
  await expect(row).toContainText('R$ 37,60');
});

test('o que espera revisao reprocessa direto, sem dialogo', async ({
  page,
  request,
}) => {
  // O escaneado de cabeca para baixo chega aqui: gira-se na revisao, e o
  // reprocessamento e o passo seguinte. Sem o botao, so pela API.
  const report = await createReport(request, { title: 'Reprocessar revisao' });
  await addReceipts(request, report.id, [
    await makeReceiptPdf({ total: '37,60' }),
  ]);

  await page.goto('/');
  await page.getByRole('tab', { name: 'Prestacao de Contas' }).click();
  await page.getByRole('button', { name: report.title }).click();

  const row = page.locator('.list-item');
  await expect(row).toContainText('Aguardando revisao');

  const reprocessed = page.waitForResponse(
    (response) =>
      response.url().endsWith('/reprocess') &&
      response.request().method() === 'POST',
  );
  await row.getByRole('button', { name: 'Reprocessar' }).click();

  // Nada foi conferido por uma pessoa: nao ha o que descartar.
  expect((await reprocessed).status()).toBe(202);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row).toContainText('Aguardando revisao', { timeout: 15000 });
});
