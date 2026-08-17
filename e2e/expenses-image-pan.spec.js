'use strict';

const { test, expect } = require('@playwright/test');
const { clearReports, createReport } = require('./helpers');
const { makeReceiptPdf } = require('../tests/fixtures/pdf');

const SCROLL = '.review__image-scroll';

test.beforeEach(async ({ request }) => {
  await clearReports(request);
});

async function openReviewWithImage(page, request, title) {
  const report = await createReport(request, { title });
  const pdf = await makeReceiptPdf({ total: '37,60', date: '19/06/2026' });

  await page.goto('/');
  await page.getByRole('tab', { name: 'Prestacao de Contas' }).click();
  await page.getByRole('button', { name: report.title }).click();
  await page.setInputFiles('.dropzone input[type=file]', [
    { name: 'cupom.pdf', mimeType: 'application/pdf', buffer: pdf },
  ]);

  await page.waitForFunction(
    () => document.body.textContent.includes('Aguardando revisao'),
    null,
    { timeout: 15000 },
  );

  await page.locator('.list-item .link-button').first().click();
  await page.waitForSelector('.review__fields');
  await page.waitForFunction(
    () => document.querySelector('.review__image')?.complete,
  );
}

/** Amplia pelo botao ate o teto de 300%. */
async function zoomToMax(page) {
  const zoomIn = page.getByRole('button', { name: 'Aumentar zoom' });

  for (let i = 0; i < 8; i += 1) {
    await zoomIn.click();
  }
}

test('a borda esquerda do cupom continua alcancavel com zoom', async ({
  page,
  request,
}) => {
  await openReviewWithImage(page, request, 'Alcance do zoom');
  await zoomToMax(page);

  const reach = await page.evaluate((selector) => {
    const box = document.querySelector(selector);
    const img = document.querySelector('.review__image');

    // Extremo esquerdo do que a rolagem permite alcancar.
    box.scrollLeft = -99999;

    return {
      recorteAEsquerda: Math.round(
        box.getBoundingClientRect().left - img.getBoundingClientRect().left,
      ),
      scrollWidth: box.scrollWidth,
      larguraDaImagem: Math.round(img.getBoundingClientRect().width),
    };
  }, SCROLL);

  // Com transform-origin `top center` este numero era 396: um terco da imagem
  // ficava a esquerda da area visivel, e nenhuma rolagem chegava la. A regiao
  // de overflow rolavel so cresce para a direita e para baixo.
  expect(reach.recorteAEsquerda).toBeLessThanOrEqual(0);

  // E o scroll cobre a imagem inteira, nao metade dela.
  expect(reach.scrollWidth).toBeGreaterThanOrEqual(reach.larguraDaImagem);
});
