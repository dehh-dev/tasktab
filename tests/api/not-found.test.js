'use strict';

const { request } = require('../orchestrator');

describe('rotas desconhecidas', () => {
  it('retorna 404 com mensagem descritiva', async () => {
    const response = await request('GET', '/api/nao-existe');

    expect(response.status).toBe(404);
    expect(response.body.name).toBe('NotFoundError');
    expect(response.body.message).toMatch(/Rota nao encontrada/);
  });
});
