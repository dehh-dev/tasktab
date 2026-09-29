'use strict';

const { request } = require('../orchestrator');

describe('GET /api/health', () => {
  it('responde 200 sem sessao quando o banco esta acessivel', async () => {
    // Publico de proposito: o probe do container consulta esta rota, e exigir
    // sessao nela faria o HEALTHCHECK do Dockerfile derrubar o container que
    // esta saudavel.
    const response = await request('GET', '/api/health', undefined, {
      token: null,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ok');
    expect(typeof response.body.data.uptime).toBe('number');
  });

  // O caminho 503 depende de derrubar o Postgres no meio da suite, o que
  // deixaria os demais testes instaveis. Fica coberto manualmente:
  // `npm run services:stop` e um curl no endpoint.
});
