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

function reprocess(receipt, body) {
  return request('POST', `/api/receipts/${receipt.id}/reprocess`, body);
}

async function read(receipt) {
  const response = await request('GET', `/api/receipts/${receipt.id}`);
  return response.body.data;
}

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

// Reprocessar regrava data, valor e categoria com o que a extracao ler. Sobre
// o que uma pessoa ja conferiu, a API passou a pedir confirmacao explicita.
describe('POST /api/receipts/:id/reprocess sobre o que ja foi conferido', () => {
  it('confirmado sem a confirmacao do descarte e 409, e nada muda', async () => {
    const report = await insertReport();
    const receipt = await uploadOne(report.id);
    await request('PATCH', `/api/receipts/${receipt.id}`, {
      amount_cents: 3670,
      category: 'alimentacao',
      status: 'confirmed',
    });

    const response = await reprocess(receipt);

    expect(response.status).toBe(409);
    expect(response.body.name).toBe('ConflictError');
    expect(response.body.action).toMatch(/descarte/);

    const after = await read(receipt);
    expect(after).toMatchObject({ status: 'confirmed', amount_cents: 3670 });
  });

  it('com discard_review, volta a revisao com o que a extracao ler', async () => {
    const report = await insertReport();
    const receipt = await uploadOne(report.id);
    await request('PATCH', `/api/receipts/${receipt.id}`, {
      amount_cents: 3670,
      category: 'alimentacao',
      status: 'confirmed',
    });

    const response = await reprocess(receipt, { discard_review: true });
    expect(response.status).toBe(202);

    await waitForProcessing(report.id);
    const after = await read(receipt);
    expect(after).toMatchObject({
      status: 'needs_review',
      amount_cents: 3760,
      extraction_source: 'text',
    });
  });

  it('corrigido a mao, mesmo sem confirmar, tambem pede a confirmacao', async () => {
    const report = await insertReport();
    const receipt = await uploadOne(report.id);
    await request('PATCH', `/api/receipts/${receipt.id}`, {
      amount_cents: 3670,
    });

    const response = await reprocess(receipt);

    expect(response.status).toBe(409);
    expect((await read(receipt)).amount_cents).toBe(3670);
  });

  it('o que veio da extracao e ninguem tocou segue sem confirmacao', async () => {
    const report = await insertReport();
    const receipt = await uploadOne(report.id);

    const response = await reprocess(receipt);

    expect(response.status).toBe(202);
  });

  it('discard_review que nao e booleano e 422 no campo', async () => {
    const report = await insertReport();
    const receipt = await uploadOne(report.id);

    const response = await reprocess(receipt, { discard_review: 'sim' });

    expect(response.status).toBe(422);
    expect(response.body.name).toBe('ValidationError');
    expect(response.body.details).toEqual([
      { field: 'discard_review', message: 'discard_review deve ser booleano' },
    ]);
  });
});
