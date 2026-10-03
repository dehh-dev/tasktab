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

    // Adiantamento que nao veio e "nao informado", e nao zero: zero e "nao
    // houve adiantamento", e sem saber qual dos dois nao ha saldo.
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      advance_cents: null,
      main_city: null,
      status: 'open',
    });
  });

  it('adiantamento zero e "nao houve", e fica zero', async () => {
    const response = await request('POST', '/api/reports', {
      ...VALID,
      advance_cents: 0,
    });

    expect(response.body.data.advance_cents).toBe(0);
  });

  it('grava a cidade principal da viagem, aparada', async () => {
    const response = await request('POST', '/api/reports', {
      ...VALID,
      main_city: '  Itapipoca/CE ',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.main_city).toBe('Itapipoca/CE');
  });

  it('cidade principal que nao e texto e 422 no campo', async () => {
    const response = await request('POST', '/api/reports', {
      ...VALID,
      main_city: 123,
    });

    expect(response.status).toBe(422);
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'main_city' }),
    );
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
});
