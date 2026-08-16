'use strict';

const { request } = require('../../orchestrator');

const VALID = {
  title: 'Viagem a Abadiania',
  period_start: '2026-06-15',
  period_end: '2026-06-25',
};

describe('POST /api/reports', () => {
  it('cria um relatorio com todos os campos', async () => {
    const response = await request('POST', '/api/reports', {
      ...VALID,
      advance_cents: 150000,
      status: 'open',
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      title: 'Viagem a Abadiania',
      period_start: '2026-06-15',
      period_end: '2026-06-25',
      advance_cents: 150000,
      status: 'open',
    });
    expect(response.headers.get('location')).toBe(
      `/api/reports/${response.body.data.id}`,
    );
  });

  it('aplica os padroes quando so o obrigatorio e enviado', async () => {
    const response = await request('POST', '/api/reports', VALID);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      advance_cents: 0,
      status: 'open',
    });
  });

  it('aceita periodo de um unico dia', async () => {
    const response = await request('POST', '/api/reports', {
      ...VALID,
      period_start: '2026-06-15',
      period_end: '2026-06-15',
    });

    expect(response.status).toBe(201);
  });

  it('rejeita titulo vazio', async () => {
    const response = await request('POST', '/api/reports', {
      ...VALID,
      title: '   ',
    });

    expect(response.status).toBe(422);
    expect(response.body.name).toBe('ValidationError');
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'title' }),
    );
  });

  it('rejeita requisicao sem periodo', async () => {
    const response = await request('POST', '/api/reports', {
      title: 'Sem periodo',
    });

    expect(response.status).toBe(422);
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'period_start' }),
    );
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'period_end' }),
    );
  });

  it('rejeita data inexistente no calendario', async () => {
    const response = await request('POST', '/api/reports', {
      ...VALID,
      period_end: '2026-02-31',
    });

    expect(response.status).toBe(422);
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'period_end' }),
    );
  });

  it('rejeita periodo invertido', async () => {
    const response = await request('POST', '/api/reports', {
      ...VALID,
      period_start: '2026-06-25',
      period_end: '2026-06-15',
    });

    expect(response.status).toBe(422);
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'period_end' }),
    );
  });

  it('rejeita adiantamento em reais, que nao e inteiro de centavos', async () => {
    const response = await request('POST', '/api/reports', {
      ...VALID,
      advance_cents: 1500.5,
    });

    expect(response.status).toBe(422);
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'advance_cents' }),
    );
  });

  it('rejeita adiantamento negativo', async () => {
    const response = await request('POST', '/api/reports', {
      ...VALID,
      advance_cents: -1,
    });

    expect(response.status).toBe(422);
  });

  it('retorna 400 para JSON malformado', async () => {
    const response = await request('POST', '/api/reports', '{"title": ');

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('JSON invalido.');
  });
});
