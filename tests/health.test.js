'use strict';

const orchestrator = require('./orchestrator');

const { request } = orchestrator;

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  orchestrator.runPendingMigrations();
});

afterAll(orchestrator.closeDatabase);

describe('GET /api/health', () => {
  it('responde 200 quando o banco esta acessivel', async () => {
    const response = await request('GET', '/api/health');

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ok');
    expect(typeof response.body.data.uptime).toBe('number');
  });

  // O caminho 503 depende de derrubar o Postgres no meio da suite, o que
  // deixaria os demais testes instaveis. Fica coberto manualmente:
  // `npm run services:stop` e um curl no endpoint.
});
