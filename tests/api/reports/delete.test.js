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
});
