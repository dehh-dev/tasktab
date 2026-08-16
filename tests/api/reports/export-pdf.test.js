'use strict';

const { PDFDocument, PDFName, PDFDict } = require('pdf-lib');
const { extractPdfText } = require('../../helpers/pdf-text');
const {
  requestBinary,
  request,
  requestUpload,
  insertReport,
  insertMerchant,
  waitForProcessing,
} = require('../../orchestrator');
const { makeReceiptPdf, makeQrReceiptPdf } = require('../../fixtures/pdf');
const fs = require('fs/promises');
const path = require('path');
const env = require('../../../src/config/env');
const db = require('../../../src/config/database');

/**
 * Grava um PDF de verdade no diretorio de upload e insere o receipt
 * apontando para ele, ja confirmado — a exportacao le o arquivo original do
 * disco, entao nao ha como testar sem um arquivo real por tras do registro.
 */
async function insertConfirmedWithFile(reportId, buffer, overrides = {}) {
  const hash = require('crypto')
    .createHash('sha256')
    .update(buffer)
    .digest('hex');
  const fileName = `${hash}.pdf`;
  await fs.mkdir(env.upload.dir, { recursive: true });
  await fs.writeFile(path.join(env.upload.dir, fileName), buffer);

  const data = {
    file_path: fileName,
    file_hash: hash,
    page_number: 1,
    status: 'confirmed',
    amount_cents: 1000,
    category: 'alimentacao',
    issued_at: '2026-06-19',
    merchant_id: null,
    ...overrides,
  };

  const { rows } = await db.query(
    `INSERT INTO receipts
       (report_id, file_path, file_hash, page_number, status, amount_cents,
        category, issued_at, merchant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      reportId,
      data.file_path,
      data.file_hash,
      data.page_number,
      data.status,
      data.amount_cents,
      data.category,
      data.issued_at,
      data.merchant_id,
    ],
  );

  return rows[0];
}

async function confirm(receipt, fields) {
  return request('PATCH', `/api/receipts/${receipt.id}`, {
    ...fields,
    status: 'confirmed',
  });
}

async function listReceipts(reportId) {
  await waitForProcessing(reportId);
  const response = await request('GET', `/api/reports/${reportId}/receipts`);
  return response.body.data;
}

function indexText(buffer) {
  return extractPdfText(buffer)[0];
}

describe('GET /api/reports/:id/export.pdf', () => {
  it('junta as paginas originais em ordem cronologica, com indice e carimbo', async () => {
    const report = await insertReport();

    // Enviados fora de ordem de proposito: a exportacao e quem ordena.
    await requestUpload(`/api/reports/${report.id}/receipts`, [
      {
        buffer: await makeReceiptPdf({ date: '20/06/2026', total: '10,00' }),
        filename: 'depois.pdf',
      },
    ]);
    await requestUpload(`/api/reports/${report.id}/receipts`, [
      {
        buffer: await makeReceiptPdf({ date: '17/06/2026', total: '20,00' }),
        filename: 'antes.pdf',
      },
    ]);

    const receipts = await listReceipts(report.id);
    await Promise.all(
      receipts.map((receipt) => confirm(receipt, { category: 'alimentacao' })),
    );

    const response = await requestBinary(
      'GET',
      `/api/reports/${report.id}/export.pdf`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');

    const doc = await PDFDocument.load(response.buffer);
    // 1 pagina de indice + 2 paginas de conteudo (uma por comprovante).
    expect(doc.getPageCount()).toBe(3);

    const text = await indexText(response.buffer);
    const posicao17 = text.indexOf('17/06/2026');
    const posicao20 = text.indexOf('20/06/2026');
    expect(posicao17).toBeGreaterThan(-1);
    expect(posicao20).toBeGreaterThan(posicao17);
  });

  it('inclui duplicata e marca no carimbo, sem excluir do PDF', async () => {
    const report = await insertReport();
    const chave = '52260626048802000165650010001631601303284889';

    await requestUpload(`/api/reports/${report.id}/receipts`, [
      {
        buffer: await makeQrReceiptPdf({ accessKey: chave }),
        filename: 'a.pdf',
      },
    ]);
    await requestUpload(`/api/reports/${report.id}/receipts`, [
      {
        buffer: await makeQrReceiptPdf({ accessKey: chave, extra: ['VIA'] }),
        filename: 'b.pdf',
      },
    ]);

    const receipts = await listReceipts(report.id);
    const duplicata = receipts.find((r) => r.status === 'duplicate');
    expect(duplicata).toBeDefined();

    const response = await requestBinary(
      'GET',
      `/api/reports/${report.id}/export.pdf`,
    );

    const doc = await PDFDocument.load(response.buffer);
    // Indice + as duas paginas, incluindo a duplicata.
    expect(doc.getPageCount()).toBe(3);

    const text = await indexText(response.buffer);
    expect(text).toMatch(/DUPLICATA/);
  });

  it('tem bookmarks de indice, categoria e data', async () => {
    const report = await insertReport();

    await requestUpload(`/api/reports/${report.id}/receipts`, [
      { buffer: await makeReceiptPdf(), filename: 'a.pdf' },
    ]);
    const [receipt] = await listReceipts(report.id);
    await confirm(receipt, { category: 'alimentacao' });

    const response = await requestBinary(
      'GET',
      `/api/reports/${report.id}/export.pdf`,
    );

    const doc = await PDFDocument.load(response.buffer);
    const outlinesRef = doc.catalog.get(PDFName.of('Outlines'));

    expect(outlinesRef).toBeDefined();
    const outlines = doc.context.lookup(outlinesRef, PDFDict);
    // Indice, Por categoria, Por data.
    expect(outlines.get(PDFName.of('Count')).numberValue).toBe(3);
  });

  it('contagem de paginas bate com origem + indice', async () => {
    const report = await insertReport();

    await requestUpload(`/api/reports/${report.id}/receipts`, [
      { buffer: await makeReceiptPdf({ pages: 3 }), filename: 'a.pdf' },
    ]);
    const receipts = await listReceipts(report.id);
    await Promise.all(
      receipts.map((r) => confirm(r, { category: 'transporte' })),
    );

    const response = await requestBinary(
      'GET',
      `/api/reports/${report.id}/export.pdf`,
    );
    const doc = await PDFDocument.load(response.buffer);

    // 3 paginas de origem + 1 de indice.
    expect(doc.getPageCount()).toBe(4);
  });

  it('renderiza acentuacao sem estourar: nome de emitente com Abadiânia', async () => {
    const report = await insertReport();
    const merchant = await insertMerchant({
      cnpj: '26048802000165',
      name: 'Pousada São Sebastião de Abadiânia',
      city: 'Abadiânia',
    });

    await insertConfirmedWithFile(report.id, await makeReceiptPdf(), {
      merchant_id: merchant.id,
    });

    const response = await requestBinary(
      'GET',
      `/api/reports/${report.id}/export.pdf`,
    );

    expect(response.status).toBe(200);
    const text = await indexText(response.buffer);
    expect(text).toContain('Abadiânia');
  });

  it('relatorio sem comprovantes gera so a pagina de indice', async () => {
    const report = await insertReport();

    const response = await requestBinary(
      'GET',
      `/api/reports/${report.id}/export.pdf`,
    );

    expect(response.status).toBe(200);
    const doc = await PDFDocument.load(response.buffer);
    expect(doc.getPageCount()).toBe(1);
  });

  it('retorna 404 para relatorio inexistente', async () => {
    const response = await requestBinary(
      'GET',
      '/api/reports/999999/export.pdf',
    );

    expect(response.status).toBe(404);
  });
});
