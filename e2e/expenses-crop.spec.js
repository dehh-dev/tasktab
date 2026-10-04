'use strict';

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

async function openReview(page, request, title, size) {
  const report = await createReport(request, { title });
  await addReceipts(request, report.id, [await makeReceiptPdf({ size })]);

  await page.goto('/');
  await openSection(page, 'Prestacao de Contas');
  await page.getByRole('button', { name: title }).click();
  await page.locator('.list-item .link-button').first().click();
  await page.waitForFunction(
    () => document.querySelector('.review__image')?.complete,
  );
}

/**
 * O pedaco da pagina que o painel mostra, em fracao da imagem — medido pelas
 * caixas na tela, que ja trazem o zoom do transform.
 */
function visibleRegion(page) {
  return page.evaluate(() => {
    const box = document.querySelector('.review__image-scroll');
    const image = document.querySelector('.review__image');
    const shown = image.getBoundingClientRect();
    const view = box.getBoundingClientRect();

    return {
      left: (view.left - shown.left) / shown.width,
      right: (view.left + box.clientWidth - shown.left) / shown.width,
      top: (view.top - shown.top) / shown.height,
      bottom: (view.top + box.clientHeight - shown.top) / shown.height,
      zoom: shown.width / image.offsetWidth,
    };
  });
}

function shortcuts(page) {
  return page.getByRole('group', { name: 'Atalhos de recorte' });
}

test('recibo em paisagem: o atalho do valor enquadra a faixa do valor', async ({
  page,
  request,
}) => {
  // Paisagem e o recibo manuscrito em bloco.
  await openReview(page, request, 'Recibo em bloco', [600, 300]);

  await expect(shortcuts(page).getByRole('button')).toHaveText([
    'Valor',
    'Data',
    'Cabecalho',
  ]);

  await shortcuts(page).getByRole('button', { name: 'Valor' }).click();

  // A faixa do valor: 55 a 100% da largura, 0 a 42% da altura, inteira no
  // painel e ampliada.
  await expect
    .poll(async () => (await visibleRegion(page)).zoom)
    .toBeGreaterThan(1);
  const region = await visibleRegion(page);
  expect(region.left).toBeLessThanOrEqual(0.56);
  expect(region.right).toBeGreaterThanOrEqual(0.99);
  expect(region.top).toBeLessThanOrEqual(0.01);
  expect(region.bottom).toBeGreaterThanOrEqual(0.41);
});

test('cupom alto: as tres fatias, e a ultima mostra o fim da pagina', async ({
  page,
  request,
}) => {
  // Retrato muito alto e o cupom termico.
  await openReview(page, request, 'Cupom termico', [300, 700]);

  await expect(shortcuts(page).getByRole('button')).toHaveText([
    'Cabecalho',
    'Topo',
    'Meio',
    'Fim',
  ]);

  await shortcuts(page).getByRole('button', { name: 'Fim' }).click();

  await expect
    .poll(async () => (await visibleRegion(page)).bottom)
    .toBeGreaterThanOrEqual(0.99);
  expect((await visibleRegion(page)).top).toBeLessThanOrEqual(0.66);
});
