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

/** Posicao central do painel, para comecar um arrasto de dentro da imagem. */
async function panelCenter(page) {
  const box = await page.locator(SCROLL).boundingBox();

  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function scrollPosition(page) {
  return page.evaluate((selector) => {
    const box = document.querySelector(selector);

    return { left: box.scrollLeft, top: box.scrollTop };
  }, SCROLL);
}

test('arrastar com o botao esquerdo move a visualizacao', async ({
  page,
  request,
}) => {
  await openReviewWithImage(page, request, 'Arrasto basico');
  await zoomToMax(page);

  // Sai do canto para que o gesto tenha para onde puxar nos dois sentidos.
  await page.evaluate((selector) => {
    const box = document.querySelector(selector);
    box.scrollLeft = 200;
    box.scrollTop = 200;
  }, SCROLL);

  const before = await scrollPosition(page);
  const start = await panelCenter(page);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // Puxa o papel para a direita e para baixo em passos, como um gesto real.
  await page.mouse.move(start.x + 60, start.y + 40, { steps: 8 });
  await page.mouse.up();

  const after = await scrollPosition(page);

  // Puxar o papel para a direita revela o que estava a esquerda: o scroll anda
  // na direcao contraria ao ponteiro.
  expect(after.left).toBe(before.left - 60);
  expect(after.top).toBe(before.top - 40);
});

test('o gesto sobrevive a soltar o botao fora do painel', async ({
  page,
  request,
}) => {
  await openReviewWithImage(page, request, 'Arrasto para fora');
  await zoomToMax(page);

  const start = await panelCenter(page);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect(
    page.locator(`${SCROLL}.review__image-scroll--dragging`),
  ).toHaveCount(1);

  // Solta bem longe do painel, sobre o formulario ao lado.
  await page.mouse.move(start.x + 400, start.y - 200, { steps: 8 });
  await page.mouse.up();

  // Sem setPointerCapture o pointerup nunca chegaria e o arrasto ficaria
  // grudado no cursor, movendo a imagem sem botao nenhum pressionado.
  await expect(
    page.locator(`${SCROLL}.review__image-scroll--dragging`),
  ).toHaveCount(0);

  const before = await scrollPosition(page);
  await page.mouse.move(start.x - 100, start.y);
  expect(await scrollPosition(page)).toEqual(before);
});

test('clicar sem mover nao desloca a imagem', async ({ page, request }) => {
  await openReviewWithImage(page, request, 'Clique parado');
  await zoomToMax(page);

  const before = await scrollPosition(page);
  const start = await panelCenter(page);

  await page.mouse.click(start.x, start.y);

  expect(await scrollPosition(page)).toEqual(before);
});

test('sem zoom o painel nao se anuncia como arrastavel', async ({
  page,
  request,
}) => {
  await openReviewWithImage(page, request, 'Sem zoom');

  // O cupom e alto: cabe na largura, nao na altura. Diminuir ate caber inteiro
  // e o que tira a promessa do ponteiro.
  const zoomOut = page.getByRole('button', { name: 'Diminuir zoom' });
  for (let i = 0; i < 2; i += 1) {
    await zoomOut.click();
  }

  await expect(
    page.locator(`${SCROLL}.review__image-scroll--pannable`),
  ).toHaveCount(0);

  await zoomToMax(page);

  await expect(
    page.locator(`${SCROLL}.review__image-scroll--pannable`),
  ).toHaveCount(1);
});
