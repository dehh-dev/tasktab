'use strict';

const { request, insertReport, insertReceipt } = require('../../orchestrator');

describe('DELETE /api/receipts/:id', () => {
  it('remove o comprovante e retorna 204', async () => {
    const report = await insertReport();
    const receipt = await insertReceipt(report.id);

    const deleted = await request('DELETE', `/api/receipts/${receipt.id}`);
    expect(deleted.status).toBe(204);

    const lookup = await request('GET', `/api/receipts/${receipt.id}`);
    expect(lookup.status).toBe(404);
  });

  it('retorna 404 ao deletar id inexistente', async () => {
    const response = await request('DELETE', '/api/receipts/999999');

    expect(response.status).toBe(404);
  });

  it('apagar o relatorio leva os comprovantes junto', async () => {
    const report = await insertReport();
    const receipt = await insertReceipt(report.id);

    await request('DELETE', `/api/reports/${report.id}`);

    // FK com ON DELETE CASCADE: nao pode sobrar comprovante orfao.
    const lookup = await request('GET', `/api/receipts/${receipt.id}`);
    expect(lookup.status).toBe(404);
  });
});
