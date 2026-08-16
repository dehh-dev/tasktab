'use strict';

const {
  requestBinary,
  request,
  requestUpload,
  waitForProcessing,
  insertReport,
  apiUrl,
} = require('../../orchestrator');
const { makeReceiptPdf } = require('../../fixtures/pdf');

async function uploadOne(reportId, buffer) {
  await requestUpload(`/api/reports/${reportId}/receipts`, [
    { buffer, filename: 'a.pdf' },
  ]);
  await waitForProcessing(reportId);
  const list = await request('GET', `/api/reports/${reportId}/receipts`);
  return list.body.data[0];
}

describe('GET /api/receipts/:id/image', () => {
  it('devolve um PNG da pagina do comprovante', async () => {
    const report = await insertReport();
    const receipt = await uploadOne(report.id, await makeReceiptPdf());

    const response = await requestBinary(
      'GET',
      `/api/receipts/${receipt.id}/image`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    // Assinatura PNG: 89 50 4E 47.
    expect(response.buffer.subarray(0, 4).toString('hex')).toBe('89504e47');
  });

  it('devolve 304 quando o ETag bate', async () => {
    const report = await insertReport();
    const receipt = await uploadOne(report.id, await makeReceiptPdf());

    const first = await requestBinary(
      'GET',
      `/api/receipts/${receipt.id}/image`,
    );
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();

    const response = await fetch(apiUrl(`/api/receipts/${receipt.id}/image`), {
      headers: { 'If-None-Match': etag },
    });

    expect(response.status).toBe(304);
  });

  it('retorna 404 para id inexistente', async () => {
    const response = await requestBinary('GET', '/api/receipts/999999/image');

    expect(response.status).toBe(404);
  });
});
