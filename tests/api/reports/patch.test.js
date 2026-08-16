'use strict';

const { request, insertReport } = require('../../orchestrator');

describe('PATCH /api/reports/:id', () => {
  it('atualiza os campos enviados', async () => {
    const created = await insertReport({ title: 'Antes' });

    const response = await request('PATCH', `/api/reports/${created.id}`, {
      title: 'Depois',
      status: 'closed',
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: created.id,
      title: 'Depois',
      status: 'closed',
    });
  });

  it('faz atualizacao parcial preservando os demais campos', async () => {
    const created = await insertReport({
      title: 'Original',
      advance_cents: 50000,
    });

    const response = await request('PATCH', `/api/reports/${created.id}`, {
      advance_cents: 75000,
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      title: 'Original',
      advance_cents: 75000,
    });
  });

  it('recusa periodo invertido quando so uma data e enviada', async () => {
    const created = await insertReport({
      period_start: '2026-06-10',
      period_end: '2026-06-20',
    });

    // A data enviada e valida sozinha; o conflito so aparece contra o que ja
    // esta gravado. Sem a checagem em conjunto isso viraria 500 na constraint.
    const response = await request('PATCH', `/api/reports/${created.id}`, {
      period_end: '2026-06-01',
    });

    expect(response.status).toBe(422);
    expect(response.body.name).toBe('ValidationError');
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'period_end' }),
    );
  });

  it('aceita mover as duas datas de uma vez', async () => {
    const created = await insertReport({
      period_start: '2026-06-10',
      period_end: '2026-06-20',
    });

    const response = await request('PATCH', `/api/reports/${created.id}`, {
      period_start: '2026-07-01',
      period_end: '2026-07-31',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.period_start).toBe('2026-07-01');
  });

  it('atualiza o updated_at pelo trigger', async () => {
    const created = await insertReport();

    const response = await request('PATCH', `/api/reports/${created.id}`, {
      title: 'Marcado',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.updated_at).not.toEqual(created.updated_at);
  });

  it('rejeita corpo sem campos atualizaveis', async () => {
    const created = await insertReport();

    const response = await request('PATCH', `/api/reports/${created.id}`, {
      foo: 'bar',
    });

    expect(response.status).toBe(422);
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'body' }),
    );
  });

  it('retorna 404 para id inexistente', async () => {
    const response = await request('PATCH', '/api/reports/999999', {
      title: 'Fantasma',
    });

    expect(response.status).toBe(404);
  });
});
