'use strict';

const { test, expect } = require('@playwright/test');
const { clearReports, createReport, addReceipts } = require('./helpers');
const { makeReceiptPdf } = require('../tests/fixtures/pdf');

test.beforeEach(async ({ request }) => {
  await clearReports(request);
});

test('girar a pagina troca a imagem e nao perde o zoom', async ({
  page,
  request,
}) => {
  const report = await createReport(request, { title: 'Pagina girada' });
  // Cupom em pe, 300 x 400 pontos.
  const [receipt] = await addReceipts(request, report.id, [
    await makeReceiptPdf(),
  ]);

  await page.goto('/');
  await page.getByRole('tab', { name: 'Prestacao de Contas' }).click();
  await page.getByRole('button', { name: report.title }).click();
  await page.locator('.list-item .link-button').first().click();
  await page.waitForFunction(
    () => document.querySelector('.review__image')?.complete,
  );

  const image = page.locator('.review__image');
  const deitada = () =>
    image.evaluate((img) => img.naturalWidth > img.naturalHeight);

  expect(await deitada()).toBe(false);

  await page.getByRole('button', { name: 'Aumentar zoom' }).click();
  await expect(page.getByText('125%')).toBeVisible();

  await page.getByRole('button', { name: 'Girar para a direita' }).click();

  // A imagem nova chega deitada, e a revisao nao remontou: o zoom ficou.
  await expect.poll(deitada).toBe(true);
  await expect(page.getByText('125%')).toBeVisible();

  const gravado = await request.get(`/api/receipts/${receipt.id}`);
  expect((await gravado.json()).data.rotation).toBe(90);
});
