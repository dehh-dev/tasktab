'use strict';

const { PDFDocument, PDFName, PDFDict } = require('pdf-lib');
const { extractPdfText } = require('../../helpers/pdf-text');
const {
  renderPdfPage,
  maxPixelDifference,
} = require('../../helpers/pdf-render');
const {
  STAMP_HEIGHT,
} = require('../../../src/services/export/pdf-consolidado.service');
const {
  requestBinary,
  request,
  requestUpload,
  insertReport,
  insertMerchant,
  saveUpload,
  waitForProcessing,
} = require('../../orchestrator');
const {
  makeCorruptPdf,
  makeReceiptPdf,
  makeQrReceiptPdf,
  makeRotatedPdf,
} = require('../../fixtures/pdf');
const db = require('../../../src/config/database');

/**
 * Grava um PDF de verdade no diretorio de upload e insere o receipt
 * apontando para ele, ja confirmado — a exportacao le o arquivo original do
 * disco, entao nao ha como testar sem um arquivo real por tras do registro.
 */
async function insertConfirmedWithFile(reportId, buffer, overrides = {}) {
  const data = {
    ...saveUpload(buffer),
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

  it('sem todas as paginas, 422 dizendo quais comprovantes faltaram', async () => {
    const report = await insertReport();
    await insertConfirmedWithFile(report.id, await makeReceiptPdf());
    // Como o upload guarda o PDF protegido ou corrompido: linha `failed`, com
    // o arquivo no disco. Era um 500 sem dizer qual comprovante.
    const ilegivel = await insertConfirmedWithFile(
      report.id,
      makeCorruptPdf(),
      {
        status: 'failed',
      },
    );
    const sumido = await insertConfirmedWithFile(
      report.id,
      await makeReceiptPdf(),
      { file_path: 'sumiu.pdf', file_hash: 'b'.repeat(64) },
    );

    const response = await request(
      'GET',
      `/api/reports/${report.id}/export.pdf`,
    );

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      {
        field: 'receipts',
        message: `comprovante ${sumido.id}: arquivo fora do disco`,
      },
      {
        field: 'receipts',
        message: `comprovante ${ilegivel.id}: PDF que nao abre`,
      },
    ]);
  });
});

// O escaneamento chega com orientacao variada, e a pagina de cabeca para
// baixo e corrigida pelo `/Rotate` — na prestacao de Itapipoca, uma das 42.
// Embutida sem a rotacao, ela voltava invertida no consolidado, enquanto a
// revisao a mostrava certa.
describe('GET /api/reports/:id/export.pdf com pagina girada', () => {
  it.each([90, 180, 270])(
    '/Rotate %i sai como a origem e exibida',
    async (angle) => {
      const report = await insertReport();
      const source = await makeRotatedPdf(angle);
      await insertConfirmedWithFile(report.id, source);

      const response = await requestBinary(
        'GET',
        `/api/reports/${report.id}/export.pdf`,
      );

      const original = renderPdfPage(source, 1);
      // A pagina 1 e o indice; a 2, o comprovante.
      const exported = renderPdfPage(response.buffer, 2);

      expect(exported.width).toBe(original.width);
      expect(exported.height).toBe(original.height + STAMP_HEIGHT);
      expect(maxPixelDifference(original, exported, original.height)).toBe(0);
    },
  );

  it('o giro escolhido na revisao soma ao /Rotate da origem', async () => {
    const report = await insertReport();
    const receipt = await insertConfirmedWithFile(
      report.id,
      await makeRotatedPdf(90),
    );
    // 90 da origem mais 90 da revisao: a pagina sai a 180, sem que o arquivo
    // original seja regravado.
    await request('PATCH', `/api/receipts/${receipt.id}`, { rotation: 90 });

    const response = await requestBinary(
      'GET',
      `/api/reports/${report.id}/export.pdf`,
    );

    const esperado = renderPdfPage(await makeRotatedPdf(180), 1);
    const exported = renderPdfPage(response.buffer, 2);

    expect(exported.width).toBe(esperado.width);
    expect(maxPixelDifference(esperado, exported, esperado.height)).toBe(0);
  });

  it('o carimbo continua no rodape, na horizontal', async () => {
    const report = await insertReport();
    await insertConfirmedWithFile(report.id, await makeRotatedPdf(90));

    const response = await requestBinary(
      'GET',
      `/api/reports/${report.id}/export.pdf`,
    );
    const exported = renderPdfPage(response.buffer, 2);
    const band = exported.pixels.subarray(
      (exported.height - STAMP_HEIGHT) * exported.width,
    );

    expect(Math.min(...band)).toBeLessThan(128);
    expect(extractPdfText(response.buffer)[1]).toMatch(
      /Item 01 \| 19\/06\/2026/,
    );
  });
});
