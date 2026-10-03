'use strict';

const { test, expect } = require('@playwright/test');
const { clearReports, createReport, addReceipts } = require('./helpers');
const { makeReceiptPdf } = require('../tests/fixtures/pdf');

test.beforeEach(async ({ request }) => {
  await clearReports(request);
});

test('a conferencia agrupa pela classe, inclusive o alerta do relatorio', async ({
  page,
  request,
}) => {
  // Adiantamento de R$ 10,00 para dois cupons de R$ 37,60 do mesmo dia: a
  // suspeita de duplicata pede decisao, e o excesso e do relatorio inteiro —
  // o alerta sem comprovante que antes nao aparecia em lugar nenhum. Os dois
  // cupons vem sem QR, e a soma deles sem chave e o outro informativo.
  const report = await createReport(request, {
    title: 'Conferencia agrupada',
    advance_cents: 1000,
  });
  await addReceipts(request, report.id, [
    await makeReceiptPdf({ extra: ['primeira via'] }),
    await makeReceiptPdf({ extra: ['segunda via'] }),
  ]);

  await page.goto('/');
  await page.getByRole('tab', { name: 'Prestacao de Contas' }).click();
  await page.getByRole('button', { name: report.title }).click();

  const panel = page.getByRole('region', { name: 'Conferencia' });
  await expect(panel.getByText('Decisao · 1')).toBeVisible();
  await expect(panel.getByText('Informativo · 2')).toBeVisible();
  await expect(panel).toContainText('passam do adiantamento');
  await expect(panel).toContainText(
    '2 comprovantes sem chave de acesso valida somam 7520 centavos',
  );

  // O alerta de comprovante leva ate ele; o do relatorio nao tem para onde.
  await expect(
    panel.getByRole('button', { name: 'Ver comprovante' }),
  ).toHaveCount(1);
  await panel.getByRole('button', { name: 'Ver comprovante' }).click();
  await expect(page.locator('.review__fields')).toBeVisible();
});
