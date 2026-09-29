'use strict';

const {
  requestBinary,
  request,
  requestUpload,
  waitForProcessing,
  insertReport,
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
    // WebP e nao PNG: na pagina escaneada de 4000x1908 medida durante o ajuste,
    // o PNG saia com 2913 KB e o WebP q92 com 451 KB — quatro vezes menos que
    // o PNG a 3x que era servido antes, e ainda assim com mais resolucao.
    expect(response.headers.get('content-type')).toBe('image/webp');
    // Container RIFF com o marcador WEBP no byte 8.
    expect(response.buffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(response.buffer.subarray(8, 12).toString('ascii')).toBe('WEBP');
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

    const response = await requestBinary(
      'GET',
      `/api/receipts/${receipt.id}/image`,
      { headers: { 'If-None-Match': etag } },
    );

    expect(response.status).toBe(304);
  });
});
