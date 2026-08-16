'use strict';

const { requestUpload, request, insertReport } = require('../../orchestrator');
const {
  makePdf,
  makeReceiptPdf,
  makeCorruptPdf,
} = require('../../fixtures/pdf');

async function upload(reportId, files) {
  return requestUpload(`/api/reports/${reportId}/receipts`, files);
}

async function listReceipts(reportId) {
  const response = await request('GET', `/api/reports/${reportId}/receipts`);
  return response.body.data;
}

describe('extracao no upload', () => {
  it('guarda o texto da pagina para auditoria', async () => {
    const report = await insertReport();

    await upload(report.id, [
      { buffer: await makeReceiptPdf({ total: '37,60' }), filename: 'a.pdf' },
    ]);

    const [receipt] = await listReceipts(report.id);

    expect(receipt.raw_text).toContain('VALOR TOTAL R$ 37,60');
    expect(receipt.raw_text).toContain('26.048.802/0001-65');
    expect(receipt.extraction_source).toBe('text');
    expect(receipt.status).toBe('needs_review');
  });

  it('guarda o texto de cada pagina separadamente', async () => {
    const report = await insertReport();

    await upload(report.id, [
      {
        buffer: await makeReceiptPdf({ pages: 2, total: '48,60' }),
        filename: 'duas.pdf',
      },
    ]);

    const receipts = await listReceipts(report.id);

    expect(receipts).toHaveLength(2);
    expect(receipts.map((receipt) => receipt.page_number)).toEqual([1, 2]);
    expect(
      receipts.every((receipt) => receipt.raw_text.includes('48,60')),
    ).toBe(true);
  });

  it('manda pagina sem texto util para a fila da rota de imagem', async () => {
    const report = await insertReport();

    await upload(report.id, [
      { buffer: await makePdf({ text: '2' }), filename: 'escaneado.pdf' },
    ]);

    const [receipt] = await listReceipts(report.id);

    // `extraction_source` nulo com `needs_review` e o marcador dessa fila —
    // e o que o OCR (M4) vai procurar.
    expect(receipt.extraction_source).toBeNull();
    expect(receipt.raw_text).toBeNull();
    expect(receipt.status).toBe('needs_review');
  });

  it('nao tenta extrair de um PDF que nem abriu', async () => {
    const report = await insertReport();

    await upload(report.id, [
      { buffer: makeCorruptPdf(), filename: 'corrompido.pdf' },
    ]);

    const [receipt] = await listReceipts(report.id);

    expect(receipt.status).toBe('failed');
    expect(receipt.raw_text).toMatch(/Falha ao ler o PDF/);
  });

  it('extrai cada arquivo do lote independentemente', async () => {
    const report = await insertReport();

    await upload(report.id, [
      { buffer: await makeReceiptPdf({ pages: 2 }), filename: 'digital.pdf' },
      { buffer: await makePdf({ text: '2' }), filename: 'escaneado.pdf' },
    ]);

    const sources = (await listReceipts(report.id))
      .map((receipt) => receipt.extraction_source)
      .sort();

    expect(sources).toEqual([null, 'text', 'text']);
  });
});
