'use strict';

const fs = require('fs/promises');

const {
  request,
  requestUpload,
  waitForProcessing,
  insertReport,
  uploadedFilePath,
} = require('../../orchestrator');
const { makeReceiptPdf } = require('../../fixtures/pdf');

async function uploadOne(reportId) {
  await requestUpload(`/api/reports/${reportId}/receipts`, [
    { buffer: await makeReceiptPdf(), filename: 'a.pdf' },
  ]);
  await waitForProcessing(reportId);
  const list = await request('GET', `/api/reports/${reportId}/receipts`);
  return list.body.data[0];
}

describe('POST /api/receipts/:id/reprocess', () => {
  it('arquivo ausente no disco e 422: reenviar e o que resolve', async () => {
    const report = await insertReport();
    const receipt = await uploadOne(report.id);
    await fs.unlink(uploadedFilePath(receipt.file_path));

    const response = await request(
      'POST',
      `/api/receipts/${receipt.id}/reprocess`,
    );

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      { field: 'file_path', message: 'arquivo ausente' },
    ]);
  });

  it('falha de leitura que nao e arquivo ausente e 500, nao "reenvie o PDF"', async () => {
    const report = await insertReport();
    const receipt = await uploadOne(report.id);
    const filePath = uploadedFilePath(receipt.file_path);

    await fs.unlink(filePath);
    await fs.mkdir(filePath);

    try {
      const response = await request(
        'POST',
        `/api/receipts/${receipt.id}/reprocess`,
      );

      expect(response.status).toBe(500);
      expect(response.body.name).toBe('InternalServerError');
    } finally {
      await fs.rmdir(filePath);
    }
  });
});
