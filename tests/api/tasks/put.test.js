'use strict';

const {
  request,
  insertTask,
  updateTaskTitleDirectly,
} = require('../../orchestrator');

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

  it('atualiza o updated_at', async () => {
    const created = await insertTask({ title: 'Marcar tempo' });

    const response = await request('PATCH', `/api/tasks/${created.id}`, {
      title: 'Marcado',
    });

    expect(response.status).toBe(200);
    expect(new Date(response.body.data.updated_at).getTime()).toBeGreaterThan(
      new Date(created.updated_at).getTime() - 1,
    );
  });

  it('atualiza o updated_at mesmo em escrita fora da API', async () => {
    const created = await insertTask({ title: 'Antes' });

    // O SQL abaixo nao toca em updated_at: quem atualiza e o trigger. Se a
    // responsabilidade voltar para o model, este teste quebra.
    const updated = await updateTaskTitleDirectly(created.id, 'Depois');

    expect(updated.updated_at).not.toEqual(created.updated_at);
    expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updated_at).getTime(),
    );
  });

  it('retorna 404 para id inexistente', async () => {
    const response = await request('PUT', '/api/tasks/999999', {
      title: 'Fantasma',
    });

    expect(response.status).toBe(404);
  });

  it('rejeita corpo sem campos atualizaveis', async () => {
    const created = await insertTask();

    const response = await request('PATCH', `/api/tasks/${created.id}`, {
      foo: 'bar',
    });

    expect(response.status).toBe(422);
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'body' }),
    );
  });

  it('rejeita title invalido na atualizacao', async () => {
    const created = await insertTask();

    const response = await request('PUT', `/api/tasks/${created.id}`, {
      title: '',
    });

    expect(response.status).toBe(422);
  });
});
