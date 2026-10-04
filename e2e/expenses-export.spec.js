'use strict';

const JSZip = require('jszip');
const { test, expect } = require('@playwright/test');
const {
  openSection,
  clearReports,
  createReport,
  addReceipts,
} = require('./helpers');
const { makeReceiptPdf } = require('../tests/fixtures/pdf');

test.beforeEach(async ({ request }) => {
  await clearReports(request);
});

async function openReportWithReceipt(page, request, report, buffer) {
  // O upload e preparo: vai pela API, que so devolve com a extracao pronta.
  await addReceipts(request, report.id, [buffer]);

  await page.goto('/');
  await openSection(page, 'Prestacao de Contas');
  await page.getByRole('button', { name: report.title }).click();
  await expect(page.locator('.list-item')).toHaveCount(1);
}

async function readDownload(download) {
  const chunks = [];

  for await (const chunk of await download.createReadStream()) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

test('exportar so libera depois que ha comprovante confirmado', async ({
  page,
  request,
}) => {
  const report = await createReport(request, { title: 'Exportacao' });
  const pdf = await makeReceiptPdf({ total: '37,60', date: '19/06/2026' });

  await openReportWithReceipt(page, request, report, pdf);

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
  const buffer = await readDownload(download);

  expect(buffer.subarray(0, 2).toString()).toBe('PK');
  expect(buffer.length).toBeGreaterThan(1000);
});

test('os PDFs por categoria saem num ZIP sem esperar a confirmacao', async ({
  page,
  request,
}) => {
  const report = await createReport(request, {
    title: 'Entrega por categoria',
  });

  await openReportWithReceipt(page, request, report, await makeReceiptPdf());

  // Como o PDF consolidado, o ZIP leva toda pagina, conferida ou nao: o
  // link ja vale com o comprovante ainda em revisao.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'PDFs por categoria' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe(`comprovantes-${report.id}.zip`);

  // Um PDF so, o da unica categoria com pagina. Conferir pagina e pixel e
  // trabalho da suite de integracao.
  const zip = await JSZip.loadAsync(await readDownload(download));
  expect(Object.keys(zip.files)).toEqual([
    expect.stringMatching(/^01_[a-z-]+\.pdf$/),
  ]);
});
