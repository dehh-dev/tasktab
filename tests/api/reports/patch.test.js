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

  it.each([
    ['em branco', '   '],
    ['que nao e texto', 123],
    ['longo demais', 'x'.repeat(256)],
  ])('recusa titulo %s com 422 no campo', async (caso, titulo) => {
    const created = await insertReport();

    const response = await request('PATCH', `/api/reports/${created.id}`, {
      title: titulo,
    });

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      expect.objectContaining({ field: 'title' }),
    ]);
  });

  it('corrige adiantamento e cidade principal; nulo volta a nao informado', async () => {
    const created = await insertReport();
    const path = `/api/reports/${created.id}`;

    const informado = await request('PATCH', path, {
      advance_cents: 150000,
      main_city: 'Itapipoca/CE',
    });
    const desfeito = await request('PATCH', path, { advance_cents: null });

    expect(informado.body.data).toMatchObject({
      advance_cents: 150000,
      main_city: 'Itapipoca/CE',
    });
    expect(desfeito.body.data).toMatchObject({
      advance_cents: null,
      main_city: 'Itapipoca/CE',
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
});
