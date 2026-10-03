'use strict';

const { test, expect } = require('@playwright/test');
const { clearReports, createReport, addReceipts } = require('./helpers');
const { makeReceiptPdf, makeCorruptPdf } = require('../tests/fixtures/pdf');

test.beforeEach(async ({ request }) => {
  await clearReports(request);
});

async function openReport(page, report) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Prestacao de Contas' }).click();
  await page.getByRole('button', { name: report.title }).click();
}

test('fechar trava a tela, e reabrir devolve as acoes', async ({
  page,
  request,
}) => {
  const report = await createReport(request, { title: 'Fechamento' });
  await addReceipts(request, report.id, [await makeReceiptPdf()]);

  await openReport(page, report);
  await expect(page.getByRole('button', { name: 'Deletar' })).toHaveCount(1);

  await page.getByRole('button', { name: 'Fechar relatorio' }).click();
  // A checagem final aponta o comprovante ainda em revisao, e nao impede.
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Fechar mesmo assim' })
    .click();

  // A API ja recusa cada escrita com 409 (ha teste de cada uma); aqui e a
  // tela nao oferecer o que seria recusado.
  await expect(page.getByText('Fechado', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deletar' })).toHaveCount(0);
  await expect(page.getByText('Arraste PDFs aqui')).toHaveCount(0);

  // A revisao abre, mas somente leitura e dizendo por que.
  await page.locator('.list-item .link-button').first().click();
  await expect(page.locator('#review-category')).toBeDisabled();
  await expect(page.getByText(/Relatorio fechado: reabra-o/)).toBeVisible();
  await page.getByRole('button', { name: 'Voltar a lista' }).click();

  await page.getByRole('button', { name: 'Reabrir relatorio' }).click();

  await expect(page.getByRole('button', { name: 'Deletar' })).toHaveCount(1);
  await expect(page.getByText('Arraste PDFs aqui')).toBeVisible();
});

test('fechar mostra a checagem final antes, e cancelar nao fecha', async ({
  page,
  request,
}) => {
  const report = await createReport(request, { title: 'Checagem final' });
  await addReceipts(request, report.id, [await makeReceiptPdf()]);

  await openReport(page, report);
  await page.getByRole('button', { name: 'Fechar relatorio' }).click();

  // Os quatro itens do procedimento, cada um dizendo em texto se confere.
  const checagem = page
    .getByRole('dialog')
    .getByRole('list', { name: 'Checagem final' });
  await expect(checagem.getByRole('listitem')).toHaveCount(4);
  await expect(checagem).toContainText(
    'Falta 1 comprovante ainda nao foi confirmado por uma pessoa.',
  );
  await expect(checagem).toContainText(
    'Confere 1 pagina recebida, cada uma em exatamente um PDF de categoria.',
  );

  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancelar' })
    .click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Fechado', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Deletar' })).toHaveCount(1);
});

test('o PDF consolidado sai sem confirmado; o Anexo I so com', async ({
  page,
  request,
}) => {
  const report = await createReport(request, { title: 'Saidas' });
  await addReceipts(request, report.id, [await makeReceiptPdf()]);

  await openReport(page, report);

  // O Anexo I e o que vai assinado: so o confirmado entra. O PDF leva todo
  // comprovante, com o status carimbado.
  await expect(page.getByRole('button', { name: 'Anexo I' })).toBeDisabled();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'PDF consolidado' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe(`relatorio-${report.id}.pdf`);
});

test('reprocessar reenfileira o comprovante que falhou', async ({
  page,
  request,
}) => {
  const report = await createReport(request, { title: 'Reprocesso' });
  await addReceipts(request, report.id, [makeCorruptPdf()]);

  await openReport(page, report);

  const reprocessed = page.waitForResponse(
    (response) =>
      response.url().endsWith('/reprocess') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Reprocessar' }).click();

  expect((await reprocessed).status()).toBe(202);
  // O PDF continua ilegivel: a pagina volta a `failed` depois da fila, e o
  // botao reaparece para uma proxima tentativa.
  await expect(page.getByRole('button', { name: 'Reprocessar' })).toBeVisible();
});
