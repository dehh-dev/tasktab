'use strict';

const { test, expect } = require('@playwright/test');
const { clearReports, createReport } = require('./helpers');
const { makeReceiptPdf } = require('../tests/fixtures/pdf');

test.beforeEach(async ({ request }) => {
  await clearReports(request);
});

async function openReportWithReceipt(page, report, buffer) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Prestacao de Contas' }).click();
  await page.getByRole('button', { name: report.title }).click();

  await page.setInputFiles('.dropzone input[type=file]', {
    name: 'cupom.pdf',
    mimeType: 'application/pdf',
    buffer,
  });

  await page.waitForFunction(
    () => document.body.textContent.includes('Aguardando revisao'),
    undefined,
    { timeout: 15000 },
  );
}

test('exportar so libera depois que ha comprovante confirmado', async ({
  page,
  request,
}) => {
  const report = await createReport(request, { title: 'Exportacao' });
  const pdf = await makeReceiptPdf({ total: '37,60', date: '19/06/2026' });

  await openReportWithReceipt(page, report, pdf);

  // Sem nenhum confirmado a planilha sairia zerada: o botao fica desligado e
  // a tela diz o que falta, em vez de entregar um arquivo vazio.
  await expect(
    page.getByRole('button', { name: 'Exportar Excel' }),
  ).toBeDisabled();
  await expect(
    page.getByText('Confirme um comprovante para poder exportar.'),
  ).toBeVisible();

  await page.locator('.list-item .link-button').first().click();
  await page.waitForSelector('.review__fields');
  await page.locator('#review-category').selectOption('alimentacao');
  await page.getByRole('button', { name: 'Confirmar' }).click();

  // Confirmar o ultimo pendente fecha a revisao e volta para a lista, agora
  // com o link de download no lugar do botao desligado.
  const link = page.getByRole('link', { name: 'Exportar Excel' });
  await expect(link).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await link.click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe(`relatorio-${report.id}.xlsx`);

  // `PK` e a assinatura de um zip — todo .xlsx e um. Conferir o conteudo
  // celula a celula e trabalho da suite de integracao.
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);

  expect(buffer.subarray(0, 2).toString()).toBe('PK');
  expect(buffer.length).toBeGreaterThan(1000);
});
