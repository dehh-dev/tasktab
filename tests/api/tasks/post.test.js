'use strict';

const { request } = require('../../orchestrator');

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

  it('converte erro inesperado em 500 sem vazar detalhe interno', async () => {
    // Um byte NUL passa na validacao — e uma string nao-vazia dentro do limite
    // — mas o Postgres recusa. E a forma de exercitar o caminho do erro
    // inesperado sem mockar nada.
    const response = await request('POST', '/api/tasks', {
      title: `antes${String.fromCharCode(0)}depois`,
    });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      name: 'InternalServerError',
      message: 'Um erro interno nao esperado aconteceu.',
      status_code: 500,
    });

    // O id de correlacao vem no corpo e no header, para casar com o log.
    expect(response.body.request_id).toEqual(expect.any(String));
    expect(response.headers.get('x-request-id')).toBe(response.body.request_id);

    // Nada do erro original pode vazar para o cliente.
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toMatch(/postgres|pg|stack|syntax/i);
  });
});
