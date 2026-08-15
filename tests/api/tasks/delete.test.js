'use strict';

const { request, insertTask } = require('../../orchestrator');

describe('DELETE /api/tasks/:id', () => {
  it('remove a tarefa e retorna 204', async () => {
    const created = await insertTask({ title: 'Para deletar' });

    const deleted = await request('DELETE', `/api/tasks/${created.id}`);
    expect(deleted.status).toBe(204);

    const lookup = await request('GET', `/api/tasks/${created.id}`);
    expect(lookup.status).toBe(404);
  });

  it('retorna 404 ao deletar id inexistente', async () => {
    const response = await request('DELETE', '/api/tasks/999999');

    expect(response.status).toBe(404);
  });
});
