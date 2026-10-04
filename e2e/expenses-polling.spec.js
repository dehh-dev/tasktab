'use strict';

const { test, expect } = require('@playwright/test');
const {
  openSection,
  clearReports,
  createReport,
  sendReceipts,
} = require('./helpers');
const { makeReceiptPdf } = require('../tests/fixtures/pdf');

// Um lote que leva varios ciclos de 1,5 s para processar, sem OCR: cada
// pagina com camada de texto custa ~160 ms, medido — uns dez segundos aqui.
// O Tesseract e o que ha de mais caro na suite, e o assunto e o
// acompanhamento, nao a extracao.
const PAGES = 60;

test.beforeEach(async ({ request }) => {
  await clearReports(request);
});

/** Abre o relatorio com o lote ainda na fila de extracao. */
async function openWhileProcessing(page, request, title) {
  const report = await createReport(request, { title });
  await sendReceipts(request, report.id, [
    await makeReceiptPdf({ pages: PAGES }),
  ]);

  await page.goto('/');
  await openSection(page, 'Prestacao de Contas');
  await page.getByRole('button', { name: title }).click();

  // Sem nada em processamento ao abrir, nao ha acompanhamento a observar.
  await expect(
    page
      .locator('.list-item')
      .filter({ hasText: /Pendente|Processando/ })
      .first(),
  ).toBeVisible();

  return report;
}

function reviewed(page) {
  return page.locator('.list-item').filter({ hasText: 'Aguardando revisao' });
}

test('durante o processamento, cada ciclo busca so a lista', async ({
  page,
  request,
}) => {
  const seen = { report: 0, receipts: 0, validation: 0 };

  // Contar e observar, nao interceptar: nenhuma resposta e trocada.
  page.on('request', (sent) => {
    const { pathname } = new URL(sent.url());

    if (sent.method() !== 'GET') return;
    if (/^\/api\/reports\/\d+$/.test(pathname)) seen.report += 1;
    if (/^\/api\/reports\/\d+\/receipts$/.test(pathname)) seen.receipts += 1;
    if (/^\/api\/reports\/\d+\/validation$/.test(pathname)) {
      seen.validation += 1;
    }
  });

  await openWhileProcessing(page, request, 'Lote em processamento');

  // A carga de abertura ja passou (e o StrictMode a faz duas vezes em
  // desenvolvimento): conta-se so o acompanhamento dali em diante.
  seen.report = 0;
  seen.receipts = 0;
  seen.validation = 0;

  await expect(reviewed(page)).toHaveCount(PAGES, { timeout: 30000 });

  // Antes, cada ciclo buscava relatorio, lista e conferencia: tres
  // requisicoes a cada 1,5 s. Agora relatorio e conferencia vem uma vez, no
  // fim, e no meio so a lista.
  expect(seen.validation).toBe(1);
  expect(seen.report).toBe(1);
  expect(seen.receipts).toBeGreaterThan(2);
});

test('a rede cai no meio do acompanhamento: avisa e retoma sozinha', async ({
  page,
  context,
  request,
}) => {
  await openWhileProcessing(page, request, 'Lote com queda de rede');

  // A rede do navegador cai de verdade: nenhuma resposta e inventada, a
  // requisicao so nao sai. Antes, o erro era engolido, nenhum ciclo novo era
  // agendado e a tela ficava em "processando" para sempre.
  await context.setOffline(true);

  const notice = page
    .getByRole('status')
    .filter({ hasText: 'Nao foi possivel acompanhar o processamento' });
  await expect(notice).toBeVisible({ timeout: 10000 });

  await context.setOffline(false);

  await expect(notice).toHaveCount(0, { timeout: 20000 });
  await expect(reviewed(page)).toHaveCount(PAGES, { timeout: 30000 });
});
