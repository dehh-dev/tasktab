'use strict';

const { request, insertTask } = require('../../orchestrator');

describe('GET /api/tasks', () => {
  it('retorna lista vazia quando nao ha tarefas', async () => {
    const response = await request('GET', '/api/tasks');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.meta).toEqual({ total: 0, limit: 50, offset: 0 });
  });

  it('lista as tarefas existentes', async () => {
    await insertTask({ title: 'Primeira' });
    await insertTask({ title: 'Segunda' });

    const response = await request('GET', '/api/tasks');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta.total).toBe(2);
    expect(response.body.data.map((task) => task.title)).toEqual(
      expect.arrayContaining(['Primeira', 'Segunda']),
    );
  });

  it('filtra por status', async () => {
    await insertTask({ title: 'Pendente', status: 'pending' });
    await insertTask({ title: 'Concluida', status: 'done' });

    const response = await request('GET', '/api/tasks?status=done');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].title).toBe('Concluida');
    expect(response.body.meta.total).toBe(1);
  });

  it('rejeita status invalido no filtro', async () => {
    const response = await request('GET', '/api/tasks?status=archived');

    expect(response.status).toBe(422);
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'status' }),
    );
  });

  it('respeita limit e offset', async () => {
    await insertTask({ title: 'A' });
    await insertTask({ title: 'B' });
    await insertTask({ title: 'C' });

    const response = await request('GET', '/api/tasks?limit=2&offset=1');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta).toEqual({ total: 3, limit: 2, offset: 1 });
  });
});

describe('GET /api/tasks/:id', () => {
  it('retorna a tarefa solicitada', async () => {
    const created = await insertTask({
      title: 'Detalhar tarefa',
      description: 'com descricao',
      status: 'in_progress',
      due_date: '2026-12-31',
    });

    const response = await request('GET', `/api/tasks/${created.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: created.id,
      title: 'Detalhar tarefa',
      description: 'com descricao',
      status: 'in_progress',
      due_date: '2026-12-31',
    });
  });

  it('retorna 404 para id inexistente', async () => {
    const response = await request('GET', '/api/tasks/999999');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      name: 'NotFoundError',
      message: 'Task 999999 nao encontrada.',
      action: 'Verifique o id informado ou liste as tarefas disponiveis.',
      status_code: 404,
    });
  });

  it('retorna 400 para id nao numerico', async () => {
    const response = await request('GET', '/api/tasks/abc');

    expect(response.status).toBe(400);
    expect(response.body.name).toBe('BadRequestError');
    expect(response.body.status_code).toBe(400);
    expect(response.body.action).toEqual(expect.any(String));
  });
});
