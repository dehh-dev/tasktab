'use strict';

const orchestrator = require('./orchestrator');

const { insertTask, request } = orchestrator;

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  orchestrator.runPendingMigrations();
});

beforeEach(orchestrator.clearDatabase);
afterAll(orchestrator.closeDatabase);

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

describe('POST /api/tasks', () => {
  it('cria uma tarefa com todos os campos', async () => {
    const payload = {
      title: 'Nova tarefa',
      description: 'Descricao completa',
      status: 'in_progress',
      due_date: '2026-08-15',
    };

    const response = await request('POST', '/api/tasks', payload);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject(payload);
    expect(response.body.data.id).toEqual(expect.any(Number));
    expect(response.headers.get('location')).toBe(
      `/api/tasks/${response.body.data.id}`,
    );
  });

  it('aplica os padroes quando so o title e enviado', async () => {
    const response = await request('POST', '/api/tasks', {
      title: 'Somente titulo',
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      title: 'Somente titulo',
      description: null,
      status: 'pending',
      due_date: null,
    });
  });

  it('rejeita requisicao sem title', async () => {
    const response = await request('POST', '/api/tasks', {
      description: 'sem titulo',
    });

    expect(response.status).toBe(422);
    expect(response.body.name).toBe('ValidationError');
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'title' }),
    );
  });

  it('rejeita title vazio ou so com espacos', async () => {
    const response = await request('POST', '/api/tasks', { title: '   ' });

    expect(response.status).toBe(422);
  });

  it('rejeita title com mais de 255 caracteres', async () => {
    const response = await request('POST', '/api/tasks', {
      title: 'a'.repeat(256),
    });

    expect(response.status).toBe(422);
    expect(response.body.details[0].message).toMatch(/255/);
  });

  it('aceita title com exatamente 255 caracteres', async () => {
    const response = await request('POST', '/api/tasks', {
      title: 'a'.repeat(255),
    });

    expect(response.status).toBe(201);
  });

  it('rejeita status fora do enum', async () => {
    const response = await request('POST', '/api/tasks', {
      title: 'Tarefa',
      status: 'cancelled',
    });

    expect(response.status).toBe(422);
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'status' }),
    );
  });

  it('rejeita due_date em formato invalido', async () => {
    const response = await request('POST', '/api/tasks', {
      title: 'Tarefa',
      due_date: '15/08/2026',
    });

    expect(response.status).toBe(422);
  });

  it('rejeita due_date inexistente no calendario', async () => {
    const response = await request('POST', '/api/tasks', {
      title: 'Tarefa',
      due_date: '2026-02-31',
    });

    expect(response.status).toBe(422);
  });

  it('retorna 400 para JSON malformado', async () => {
    const response = await request('POST', '/api/tasks', '{"title": ');

    expect(response.status).toBe(400);
    expect(response.body.name).toBe('BadRequestError');
    expect(response.body.message).toBe('JSON invalido.');
  });
});

describe('PUT /api/tasks/:id', () => {
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

describe('rotas desconhecidas', () => {
  it('retorna 404 com mensagem descritiva', async () => {
    const response = await request('GET', '/api/nao-existe');

    expect(response.status).toBe(404);
    expect(response.body.name).toBe('NotFoundError');
    expect(response.body.message).toMatch(/Rota nao encontrada/);
  });
});
