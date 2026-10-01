'use strict';

const { request, insertTask } = require('../../orchestrator');

describe('PATCH /api/tasks/:id', () => {
  it('atualiza os campos enviados', async () => {
    const created = await insertTask({ title: 'Antes', status: 'pending' });

    const response = await request('PATCH', `/api/tasks/${created.id}`, {
      title: 'Depois',
      status: 'done',
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: created.id,
      title: 'Depois',
      status: 'done',
    });
  });

  it('faz atualizacao parcial preservando os demais campos', async () => {
    const created = await insertTask({
      title: 'Titulo original',
      description: 'Descricao original',
      status: 'pending',
    });

    const response = await request('PATCH', `/api/tasks/${created.id}`, {
      status: 'in_progress',
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      title: 'Titulo original',
      description: 'Descricao original',
      status: 'in_progress',
    });
  });

  it('permite limpar campos opcionais com null', async () => {
    const created = await insertTask({
      title: 'Com opcionais',
      description: 'algo',
      due_date: '2026-09-01',
    });

    const response = await request('PATCH', `/api/tasks/${created.id}`, {
      description: null,
      due_date: null,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.description).toBeNull();
    expect(response.body.data.due_date).toBeNull();
  });

  it('PUT nao existe: a atualizacao e parcial, e isso e PATCH', async () => {
    // O PUT chamava o mesmo controller e fazia atualizacao parcial, que nao e
    // o que um PUT significa. A interface sempre usou PATCH.
    const created = await insertTask();

    const response = await request('PUT', `/api/tasks/${created.id}`, {
      title: 'Depois',
    });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD, PATCH, DELETE');
  });

  it('rejeita title invalido na atualizacao', async () => {
    const created = await insertTask();

    const response = await request('PATCH', `/api/tasks/${created.id}`, {
      title: '',
    });

    expect(response.status).toBe(422);
  });
});
