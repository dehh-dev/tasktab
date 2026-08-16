'use strict';

const { test, expect } = require('@playwright/test');
const { clearReports, createReport } = require('./helpers');
const { makeReceiptPdf } = require('../tests/fixtures/pdf');

test.beforeEach(async ({ request }) => {
  await clearReports(request);
});

async function openExpensesTab(page) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Prestacao de Contas' }).click();
}

test('cria um relatorio e ve na lista', async ({ page }) => {
  await openExpensesTab(page);

  await expect(page.getByText('Nenhum relatorio ainda.')).toBeVisible();

  await page.getByRole('button', { name: 'Novo relatorio' }).click();

  const form = page.locator('form.form');
  await form.getByLabel('Titulo').fill('Viagem a Abadiania');
  await form.getByLabel('Periodo — inicio').fill('2026-06-01');
  await form.getByLabel('Periodo — fim').fill('2026-06-30');
  await form.getByRole('button', { name: 'Criar relatorio' }).click();

  // Criar abre o detalhe direto; volta para a lista para conferir que o
  // relatorio ficou salvo.
  await page.getByRole('button', { name: 'Voltar' }).click();

  await expect(page.getByText('Viagem a Abadiania')).toBeVisible();
  await expect(page.getByText('1 relatorio', { exact: true })).toBeVisible();
});

test('exige titulo e periodo antes de criar', async ({ page }) => {
  await openExpensesTab(page);
  await page.getByRole('button', { name: 'Novo relatorio' }).click();

  let requested = false;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/reports')) {
      requested = true;
    }
  });

  await page.getByRole('button', { name: 'Criar relatorio' }).click();

  await expect(page.getByText('title e obrigatorio')).toBeVisible();
  expect(requested).toBe(false);
});

test('envia um PDF por clique e ve o total atualizar', async ({
  page,
  request,
}) => {
  const report = await createReport(request, { title: 'Com upload' });
  const pdf = await makeReceiptPdf({ total: '37,60', date: '19/06/2026' });

  await openExpensesTab(page);
  await page.getByRole('button', { name: report.title }).click();

  await page.setInputFiles('.dropzone input[type=file]', {
    name: 'cupom.pdf',
    mimeType: 'application/pdf',
    buffer: pdf,
  });

  // O upload responde 202 e o processamento roda em segundo plano: o total
  // so aparece depois do polling capturar o needs_review.
  // O valor aparece duas vezes de proposito (resumo e linha do comprovante):
  // escopar ao resumo evita o modo estrito do Playwright reclamar.
  await expect(page.locator('.summary').getByText('R$ 37,60')).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText('Aguardando revisao')).toBeVisible();
});

test('envia um PDF arrastando para a zona de soltar', async ({
  page,
  request,
}) => {
  const report = await createReport(request, { title: 'Com arrastar' });
  const pdf = await makeReceiptPdf({ total: '48,60' });

  await openExpensesTab(page);
  await page.getByRole('button', { name: report.title }).click();

  const dataTransfer = await page.evaluateHandle(
    async ([base64]) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      const file = new File([bytes], 'arrastado.pdf', {
        type: 'application/pdf',
      });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      return transfer;
    },
    [pdf.toString('base64')],
  );

  const dropzone = page.locator('.dropzone');
  await dropzone.dispatchEvent('drop', { dataTransfer });

  await expect(page.locator('.summary').getByText('R$ 48,60')).toBeVisible({
    timeout: 15000,
  });
});

test('mostra erro do servidor ao subir arquivo que nao e PDF', async ({
  page,
  request,
}) => {
  const report = await createReport(request, { title: 'Arquivo invalido' });

  await openExpensesTab(page);
  await page.getByRole('button', { name: report.title }).click();

  await page.setInputFiles('.dropzone input[type=file]', {
    name: 'nao-e-pdf.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('isto nao e um PDF'),
  });

  // O cliente nao filtra por conteudo: o servidor confere os magic bytes e
  // devolve a mensagem, que o formulario exibe no alerta.
  await expect(page.getByText(/nao e um PDF/)).toBeVisible();
});
