'use strict';

const { request, insertReport } = require('../../orchestrator');

describe('DELETE /api/reports/:id', () => {
  it('remove o relatorio e retorna 204', async () => {
    const created = await insertReport({ title: 'Para deletar' });

    const deleted = await request('DELETE', `/api/reports/${created.id}`);
    expect(deleted.status).toBe(204);

    const lookup = await request('GET', `/api/reports/${created.id}`);
    expect(lookup.status).toBe(404);
  });

  it('retorna 404 ao deletar id inexistente', async () => {
    const response = await request('DELETE', '/api/reports/999999');

    expect(response.status).toBe(404);
  });
});
