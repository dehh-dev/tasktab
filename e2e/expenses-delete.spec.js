'use strict';

const { test, expect } = require('@playwright/test');
const { clearReports, createReport } = require('./helpers');
const { makeReceiptPdf } = require('../tests/fixtures/pdf');

test.beforeEach(async ({ request }) => {
  await clearReports(request);
});

async function openReportWithReceipts(page, report, buffers) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Prestacao de Contas' }).click();
  await page.getByRole('button', { name: report.title }).click();

  await page.setInputFiles(
    '.dropzone input[type=file]',
    buffers.map((buffer, index) => ({
      name: `cupom-${index}.pdf`,
      mimeType: 'application/pdf',
      buffer,
    })),
  );

  // O upload responde 202 e a extracao roda em fila: esperar as linhas sairem
  // de "processando" evita agir sobre uma lista que ainda vai mudar sozinha.
  await page.waitForFunction(
    (expected) =>
      (document.body.textContent.match(/Aguardando revisao/g) || []).length >=
      expected,
    buffers.length,
    { timeout: 15000 },
  );
}

/** A linha da lista que contem um texto — "Deletar" existe em todas elas. */
function row(page, text) {
  return page.locator('.list-item').filter({ hasText: text });
}

test('deleta um comprovante pela lista e o total acompanha', async ({
  page,
  request,
}) => {
  const report = await createReport(request, { title: 'Descarte pela lista' });
  const pdfA = await makeReceiptPdf({
    total: '10,00',
    date: '10/06/2026',
    extra: ['primeiro'],
  });
  const pdfB = await makeReceiptPdf({
    total: '20,00',
    date: '11/06/2026',
    extra: ['segundo'],
  });

  await openReportWithReceipts(page, report, [pdfA, pdfB]);
  await expect(page.locator('.list-item')).toHaveCount(2);

  await row(page, '20,00').getByRole('button', { name: 'Deletar' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // O alvo identifica o comprovante: sem emitente extraido, data e valor sao o
  // unico jeito de conferir que se esta apagando o cupom certo.
  await expect(dialog).toContainText('R$ 20,00');
  await expect(page.locator('.list-item')).toHaveCount(2);

  await dialog.getByRole('button', { name: 'Deletar' }).click();

  await expect(page.locator('.list-item')).toHaveCount(1);
  await expect(row(page, '20,00')).toHaveCount(0);
  // Deletar da lista nao sequestra a tela para a revisao do que sobrou.
  await expect(page.locator('.review__fields')).toHaveCount(0);
  await expect(page.locator('.upload')).toBeVisible();
});

test('cancelar mantem o comprovante', async ({ page, request }) => {
  const report = await createReport(request, { title: 'Cancelar descarte' });
  const pdf = await makeReceiptPdf({ total: '37,60', date: '19/06/2026' });

  await openReportWithReceipts(page, report, [pdf]);

  await page
    .locator('.list-item')
    .getByRole('button', { name: 'Deletar' })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancelar' })
    .click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.list-item')).toHaveCount(1);
});

test('deleta da tela de revisao e segue para o proximo pendente', async ({
  page,
  request,
}) => {
  const report = await createReport(request, { title: 'Descarte na revisao' });
  const pdfA = await makeReceiptPdf({
    total: '10,00',
    date: '10/06/2026',
    extra: ['primeiro'],
  });
  const pdfB = await makeReceiptPdf({
    total: '20,00',
    date: '11/06/2026',
    extra: ['segundo'],
  });

  await openReportWithReceipts(page, report, [pdfA, pdfB]);

  await page.locator('.list-item .link-button').first().click();
  await page.waitForSelector('.review__fields');

  const firstAmount = await page.locator('#review-amount').inputValue();

  await page
    .locator('.toolbar')
    .getByRole('button', { name: 'Deletar' })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Deletar' })
    .click();

  // Continua revisando — agora o outro comprovante, ja que a fila nao esvaziou.
  await page.waitForSelector('.review__fields');
  await expect(page.locator('.filter__count').first()).toContainText(
    '1 de 1 pendentes',
  );
  await expect(page.locator('#review-amount')).not.toHaveValue(firstAmount);
});

test('deletar o ultimo pendente fecha a revisao', async ({ page, request }) => {
  const report = await createReport(request, { title: 'Ultimo pendente' });
  const pdf = await makeReceiptPdf({ total: '37,60', date: '19/06/2026' });

  await openReportWithReceipts(page, report, [pdf]);

  await page.locator('.list-item .link-button').first().click();
  await page.waitForSelector('.review__fields');

  await page
    .locator('.toolbar')
    .getByRole('button', { name: 'Deletar' })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Deletar' })
    .click();

  await expect(page.locator('.review__fields')).toHaveCount(0);
  await expect(page.locator('.list-item')).toHaveCount(0);
  await expect(page.getByText('Nenhum comprovante ainda')).toBeVisible();
});

test('Escape no dialogo cancela sem fechar a revisao junto', async ({
  page,
  request,
}) => {
  const report = await createReport(request, { title: 'Escape na revisao' });
  const pdf = await makeReceiptPdf({ total: '37,60', date: '19/06/2026' });

  await openReportWithReceipts(page, report, [pdf]);

  await page.locator('.list-item .link-button').first().click();
  await page.waitForSelector('.review__fields');

  await page
    .locator('.toolbar')
    .getByRole('button', { name: 'Deletar' })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.keyboard.press('Escape');

  // O keydown do Escape borbulha ate o listener de document da ReceiptReview:
  // sem a guarda de `dialog[open]`, um unico Escape cancelava a exclusao e
  // ainda jogava a pessoa de volta na lista.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.review__fields')).toBeVisible();

  // Com o dialogo fechado o Escape volta a ser da revisao, e o comprovante
  // continua la — cancelar nao apagou nada.
  await page.keyboard.press('Escape');
  await expect(page.locator('.review__fields')).toHaveCount(0);
  await expect(page.locator('.list-item')).toHaveCount(1);
});
