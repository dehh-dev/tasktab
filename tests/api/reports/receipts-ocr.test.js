'use strict';

const {
  requestUpload,
  request,
  insertReport,
  waitForProcessing,
} = require('../../orchestrator');
const { makeScannedReceiptPdf, makeReceiptPdf } = require('../../fixtures/pdf');

async function upload(reportId, files) {
  return requestUpload(`/api/reports/${reportId}/receipts`, files);
}

async function listReceipts(reportId) {
  await waitForProcessing(reportId);
  const response = await request('GET', `/api/reports/${reportId}/receipts`);
  return response.body.data;
}

describe('OCR de pagina escaneada', () => {
  it('le o cupom sem camada de texto', async () => {
    const report = await insertReport();

    await upload(report.id, [
      {
        buffer: await makeScannedReceiptPdf({
          total: '37,60',
          date: '19/06/2026',
        }),
        filename: 'escaneado.pdf',
      },
    ]);

    const [receipt] = await listReceipts(report.id);

    expect(receipt.extraction_source).toBe('ocr');
    expect(receipt.raw_text).toMatch(/FRANGUINHO/i);
    expect(receipt.amount_cents).toBe(3760);
    expect(receipt.issued_at).toBe('2026-06-19');
  });

  it('nunca confirma sozinho o que veio de OCR', async () => {
    const report = await insertReport();

    await upload(report.id, [
      { buffer: await makeScannedReceiptPdf(), filename: 'escaneado.pdf' },
    ]);

    const [receipt] = await listReceipts(report.id);

    // O caminho menos confiavel da cascata e o que menos pode decidir sozinho.
    expect(receipt.status).toBe('needs_review');
  });

  it('registra confianca menor que a de um PDF digital', async () => {
    const report = await insertReport();

    await upload(report.id, [
      { buffer: await makeScannedReceiptPdf(), filename: 'escaneado.pdf' },
      { buffer: await makeReceiptPdf(), filename: 'digital.pdf' },
    ]);

    const receipts = await listReceipts(report.id);
    const escaneado = receipts.find((r) => r.extraction_source === 'ocr');
    const digital = receipts.find((r) => r.extraction_source === 'text');

    // A confianca guia o destaque na revisao: o que veio de imagem merece
    // mais atencao que o que veio da camada de texto.
    expect(Number(escaneado.confidence)).toBeLessThanOrEqual(
      Number(digital.confidence),
    );
  });

  it('nao roda OCR quando ja ha camada de texto', async () => {
    const report = await insertReport();

    await upload(report.id, [
      { buffer: await makeReceiptPdf(), filename: 'digital.pdf' },
    ]);

    const [receipt] = await listReceipts(report.id);

    // OCR e o degrau mais caro: so desce ate ele quem precisa.
    expect(receipt.extraction_source).toBe('text');
  });
});

describe('processamento assincrono', () => {
  it('responde 202 e cria as linhas antes de processar', async () => {
    const report = await insertReport();

    const response = await upload(report.id, [
      { buffer: await makeReceiptPdf({ pages: 2 }), filename: 'a.pdf' },
    ]);

    // 202: os registros existem, o conteudo ainda esta sendo lido.
    expect(response.status).toBe(202);
    expect(response.body.data).toHaveLength(2);
    expect(
      response.body.data.every((receipt) => receipt.status === 'pending'),
    ).toBe(true);
  });

  it('o status progride ate needs_review', async () => {
    const report = await insertReport();

    await upload(report.id, [
      { buffer: await makeReceiptPdf(), filename: 'a.pdf' },
    ]);

    const [receipt] = await listReceipts(report.id);

    expect(receipt.status).toBe('needs_review');
  });

  it('reprocessa um comprovante pela rota', async () => {
    const report = await insertReport();

    await upload(report.id, [
      { buffer: await makeReceiptPdf({ total: '48,60' }), filename: 'a.pdf' },
    ]);

    const [receipt] = await listReceipts(report.id);

    // Simula o que sobra de um reinicio no meio do lote: a fila vive na
    // memoria do processo, entao ha registros que ficam presos em processing.
    await request('PATCH', `/api/receipts/${receipt.id}`, {
      amount_cents: null,
    });

    const response = await request(
      'POST',
      `/api/receipts/${receipt.id}/reprocess`,
    );

    expect(response.status).toBe(202);

    const [reprocessado] = await listReceipts(report.id);
    expect(reprocessado.amount_cents).toBe(4860);
  });

  it('retorna 404 ao reprocessar id inexistente', async () => {
    const response = await request('POST', '/api/receipts/999999/reprocess');

    expect(response.status).toBe(404);
  });
});
