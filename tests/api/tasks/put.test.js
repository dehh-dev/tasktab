'use strict';

const { request, insertTask } = require('../../orchestrator');

describe('PUT|PATCH /api/tasks/:id', () => {
  it('atualiza os campos enviados', async () => {
    const created = await insertTask({ title: 'Antes', status: 'pending' });

    const response = await request('PUT', `/api/tasks/${created.id}`, {
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

  it('rejeita title invalido na atualizacao', async () => {
    const created = await insertTask();

    const response = await request('PUT', `/api/tasks/${created.id}`, {
      title: '',
    });

    expect(response.status).toBe(422);
  });
});
