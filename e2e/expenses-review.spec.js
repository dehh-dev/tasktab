'use strict';

const { test, expect } = require('@playwright/test');
const { clearReports, createReport, addReceipts } = require('./helpers');
const { makeReceiptPdf, makeQrReceiptPdf } = require('../tests/fixtures/pdf');

test.beforeEach(async ({ request }) => {
  await clearReports(request);
});

async function openExpensesTab(page) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Prestacao de Contas' }).click();
}

async function uploadAndOpenReview(page, request, report, buffers) {
  // Aqui o upload e preparo, e nao o assunto: vai pela API, que ja espera a
  // extracao terminar. O upload pela tela tem as specs dele.
  await addReceipts(request, report.id, buffers);

  await openExpensesTab(page);
  await page.getByRole('button', { name: report.title }).click();

  await page.locator('.list-item .link-button').first().click();
  await page.waitForSelector('.review__fields');
  await page.waitForFunction(
    () => document.querySelector('.review__image')?.complete,
  );
}

test('abre a revisao preenchida pela extracao, com a origem e sem a chave', async ({
  page,
  request,
}) => {
  const report = await createReport(request, { title: 'Revisao basica' });
  const chave = '52260626048802000165650010001631601303284889';
  const pdf = await makeQrReceiptPdf({
    accessKey: chave,
    total: '37,60',
    date: '19/06/2026',
  });

  await uploadAndOpenReview(page, request, report, [pdf]);

  await expect(page.locator('#review-date')).toHaveValue('2026-06-19');
  await expect(page.locator('#review-amount')).toHaveValue('37,60');
  // A imagem e servida por endpoint proprio, mesma origem — nunca blob:.
  const src = await page.locator('.review__image').getAttribute('src');
  expect(src).toMatch(/^\/api\/receipts\/\d+\/image$/);

  // A origem continua a vista — QR e a mais confiavel que a extracao produz,
  // e e isso que diz o quanto confiar no que esta preenchido. A chave, nao:
  // sao 44 digitos que ninguem confere a olho, e ocupavam a primeira linha
  // da tela acima da data.
  await expect(page.getByText(/QR Code/)).toBeVisible();
  await expect(page.getByText(chave)).toHaveCount(0);
  // Com a chave lida, nao ha o que digitar: o campo so aparece quando ela
  // falta (expenses-access-key.spec.js).
  await expect(page.locator('#review-access-key')).toHaveCount(0);
});

test('confirmar avanca para o proximo pendente sem recarregar', async ({
  page,
  request,
}) => {
  const report = await createReport(request, { title: 'Duas pendencias' });
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

  await uploadAndOpenReview(page, request, report, [pdfA, pdfB]);

  await expect(page.locator('.filter__count').first()).toContainText(
    '1 de 2 pendentes',
  );

  await page.locator('#review-category').selectOption('alimentacao');

  let reloaded = true;
  page.once('load', () => {
    reloaded = true;
  });
  reloaded = false;

  await page.getByRole('button', { name: 'Confirmar' }).click();

  // Segue na tela de revisao, agora no outro comprovante — nao fechou nem
  // recarregou a pagina.
  await page.waitForSelector('.review__fields');
  await page.waitForFunction(
    () => document.querySelector('.review__image')?.complete,
  );

  expect(reloaded).toBe(false);
  await expect(page.locator('.filter__count').first()).toContainText(
    '1 de 1 pendentes',
  );
});

test('confirmar o ultimo pendente fecha a revisao', async ({
  page,
  request,
}) => {
  const report = await createReport(request, { title: 'Uma pendencia' });
  const pdf = await makeReceiptPdf({ total: '37,60', date: '19/06/2026' });

  await uploadAndOpenReview(page, request, report, [pdf]);

  await page.locator('#review-category').selectOption('alimentacao');
  await page.getByRole('button', { name: 'Confirmar' }).click();

  await expect(page.locator('.review__fields')).toHaveCount(0);
  await expect(
    page.locator('.summary').getByText('R$ 37,60').first(),
  ).toBeVisible();
});

test('recusa confirmar sem categoria, sem chamar a API', async ({
  page,
  request,
}) => {
  const report = await createReport(request, { title: 'Sem categoria' });
  const pdf = await makeReceiptPdf({ total: '37,60', date: '19/06/2026' });

  await uploadAndOpenReview(page, request, report, [pdf]);

  // Depois do piso `alimentacao` nao existe mais comprovante que chegue sem
  // categoria: para exercitar a validacao e preciso esvaziar o campo a mao.
  // A regra continua valendo — confirmar sem categoria nao pode sair daqui.
  await page.locator('#review-category').selectOption('');

  let patched = false;
  page.on('request', (req) => {
    if (req.method() === 'PATCH') {
      patched = true;
    }
  });

  await page.getByRole('button', { name: 'Confirmar' }).click();

  await expect(page.getByText('category e obrigatorio')).toBeVisible();
  expect(patched).toBe(false);
});

test('navega entre pendentes com Alt+seta e fecha com Escape', async ({
  page,
  request,
}) => {
  const report = await createReport(request, { title: 'Navegacao' });
  const pdfA = await makeReceiptPdf({
    total: '10,00',
    date: '10/06/2026',
    extra: ['x'],
  });
  const pdfB = await makeReceiptPdf({
    total: '20,00',
    date: '11/06/2026',
    extra: ['y'],
  });

  await uploadAndOpenReview(page, request, report, [pdfA, pdfB]);

  const firstAmount = await page.locator('#review-amount').inputValue();

  await page.keyboard.press('Alt+ArrowRight');
  await page.waitForSelector('.review__fields');
  await page.waitForFunction(
    () => document.querySelector('.review__image')?.complete,
  );

  const secondAmount = await page.locator('#review-amount').inputValue();
  expect(secondAmount).not.toBe(firstAmount);

  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForFunction(
    () => document.querySelector('.review__image')?.complete,
  );
  await expect(page.locator('#review-amount')).toHaveValue(firstAmount);

  await page.keyboard.press('Escape');
  await expect(page.locator('.review__fields')).toHaveCount(0);
  await expect(page.locator('.upload')).toBeVisible();
});

test('sugestao de duplicata: marcar avanca, dispensar so esconde', async ({
  page,
  request,
}) => {
  const report = await createReport(request, { title: 'Duplicata provavel' });
  const pdfA = await makeReceiptPdf({
    total: '10,00',
    date: '20/06/2026',
    extra: ['via cliente'],
  });
  const pdfB = await makeReceiptPdf({
    total: '10,00',
    date: '20/06/2026',
    extra: ['via estabelecimento'],
  });

  await uploadAndOpenReview(page, request, report, [pdfA, pdfB]);

  const alert = page.locator('.alert', { hasText: 'Mesma data e mesmo valor' });
  await expect(alert).toBeVisible();

  await alert.getByRole('button', { name: 'Marcar como duplicata' }).click();

  // Avancou para o outro pendente sem fechar a tela.
  await page.waitForFunction(
    () => document.querySelector('.review__image')?.complete,
  );
  await expect(page.locator('.review__fields')).toBeVisible();

  await page.getByRole('button', { name: 'Voltar a lista' }).click();
  await expect(page.locator('.badge--duplicate')).toHaveText('Duplicata');
});

test('a categoria adivinhada chega marcada, e a marca some ao escolher', async ({
  page,
  request,
}) => {
  const report = await createReport(request, { title: 'Palpite marcado' });
  const pdf = await makeReceiptPdf({ total: '37,60', date: '19/06/2026' });

  await uploadAndOpenReview(page, request, report, [pdf]);

  // A categoria vem preenchida **marcada**: a palavra "sugerida" e o que
  // separa um palpite de um dado lido do documento.
  await expect(page.locator('#review-category')).toHaveValue('alimentacao');
  await expect(page.getByText(/Sugerida pelo nome do emitente/)).toBeVisible();

  // Escolhida a categoria por uma pessoa, o aviso sai: a decisao passou a ser
  // dela, e continuar avisando seria mentira.
  await page.locator('#review-category').selectOption('outros');
  await expect(page.getByText(/Sugerida pelo nome do emitente/)).toHaveCount(0);
});
