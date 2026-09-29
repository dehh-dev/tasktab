'use strict';

const { request } = require('../orchestrator');

describe('rotas desconhecidas', () => {
  it('retorna 404 com mensagem descritiva, com ou sem sessao', async () => {
    // O portao de sessao fica em cada rota (`requireScope`), e nao na frente
    // de toda a `/api`: o que nao casa com rota nenhuma chega ao 404 com ou
    // sem cookie.
    for (const token of [undefined, null]) {
      const response = await request('GET', '/api/nao-existe', undefined, {
        token,
      });

      expect(response.status).toBe(404);
      expect(response.body.name).toBe('NotFoundError');
      expect(response.body.message).toMatch(/Rota nao encontrada/);
    }
  });
});
