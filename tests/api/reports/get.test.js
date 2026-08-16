'use strict';

const { request, insertReport } = require('../../orchestrator');

describe('GET /api/reports', () => {
  it('retorna lista vazia quando nao ha relatorios', async () => {
    const response = await request('GET', '/api/reports');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.meta).toEqual({ total: 0, limit: 50, offset: 0 });
  });

  it('lista os relatorios existentes', async () => {
    await insertReport({ title: 'Junho' });
    await insertReport({ title: 'Julho' });

    const response = await request('GET', '/api/reports');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta.total).toBe(2);
    expect(response.body.data.map((report) => report.title)).toEqual(
      expect.arrayContaining(['Junho', 'Julho']),
    );
  });

  it('filtra por status', async () => {
    await insertReport({ title: 'Aberto', status: 'open' });
    await insertReport({ title: 'Fechado', status: 'closed' });

    const response = await request('GET', '/api/reports?status=closed');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].title).toBe('Fechado');
  });

  it('rejeita status invalido no filtro', async () => {
    const response = await request('GET', '/api/reports?status=arquivado');

    expect(response.status).toBe(422);
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'status' }),
    );
  });
});

describe('GET /api/reports/:id', () => {
  it('retorna o relatorio solicitado', async () => {
    const created = await insertReport({
      title: 'Viagem a Goiania',
      period_start: '2026-06-15',
      period_end: '2026-06-25',
      advance_cents: 150000,
    });

    const response = await request('GET', `/api/reports/${created.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: created.id,
      title: 'Viagem a Goiania',
      advance_cents: 150000,
      status: 'open',
    });
  });

  it('devolve as datas como string, sem deslocar um dia', async () => {
    const created = await insertReport({
      period_start: '2026-06-01',
      period_end: '2026-06-30',
    });

    const response = await request('GET', `/api/reports/${created.id}`);

    expect(response.body.data.period_start).toBe('2026-06-01');
    expect(response.body.data.period_end).toBe('2026-06-30');
  });

  it('retorna 404 para id inexistente', async () => {
    const response = await request('GET', '/api/reports/999999');

    expect(response.status).toBe(404);
    expect(response.body.name).toBe('NotFoundError');
    expect(response.body.action).toEqual(expect.any(String));
  });

  it('retorna 400 para id nao numerico', async () => {
    const response = await request('GET', '/api/reports/abc');

    expect(response.status).toBe(400);
    expect(response.body.name).toBe('BadRequestError');
  });
});
