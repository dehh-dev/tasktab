'use strict';

const {
  request,
  DEFAULT_USER,
  DEFAULT_PASSWORD,
  createUserWithSession,
  currentUser,
  insertSession,
  sessionHoursLeft,
} = require('../../orchestrator');

describe('GET /api/auth/me', () => {
  it('devolve quem esta na sessao, com os escopos do papel', async () => {
    const response = await request('GET', '/api/auth/me');

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      email: DEFAULT_USER.email,
      role: 'admin',
    });
  });

  it('responde 401 com token inventado', async () => {
    const response = await request('GET', '/api/auth/me', undefined, {
      token: 'token-que-nunca-existiu',
    });

    expect(response.status).toBe(401);
  });

  it('trata cookie malformado como sessao ausente, e nao como erro interno', async () => {
    // `%E0%A4%A` nao decodifica. Antes isso virava 500 em toda a API.
    const response = await request('GET', '/api/auth/me', undefined, {
      token: '%E0%A4%A',
    });

    expect(response.status).toBe(401);
    expect(response.body.name).toBe('UnauthorizedError');
  });

  it('o auditor recebe os escopos de leitura e nenhum de escrita', async () => {
    const { token } = await createUserWithSession({ role: 'auditor' });
    const response = await request('GET', '/api/auth/me', undefined, { token });

    expect(response.body.data.scopes).toContain('reports:read:any');
    expect(response.body.data.scopes).not.toContain('reports:write');
    expect(response.body.data.scopes).not.toContain('users:read');
  });
});

describe('POST /api/auth/logout', () => {
  it('encerra a sessao e o token para de valer na hora', async () => {
    const login = await request(
      'POST',
      '/api/auth/login',
      { email: DEFAULT_USER.email, password: DEFAULT_PASSWORD },
      { token: null },
    );

    const token = /tasktab_session=([^;]+)/.exec(
      login.headers.get('set-cookie'),
    )[1];

    const logout = await request('POST', '/api/auth/logout', undefined, {
      token,
    });

    expect(logout.status).toBe(204);

    // E o que uma sessao no banco entrega e um JWT nao: revogacao imediata,
    // sem esperar o token vencer.
    const depois = await request('GET', '/api/auth/me', undefined, { token });
    expect(depois.status).toBe(401);
  });
});

describe('renovacao da sessao', () => {
  const TTL_HOURS = 168;

  it('renova a sessao que passou da metade da validade, no banco e no cookie', async () => {
    const token = await insertSession(currentUser().id, undefined, {
      hours: 1,
    });

    const response = await request('GET', '/api/auth/me', undefined, {
      token,
    });

    expect(response.status).toBe(200);
    expect(await sessionHoursLeft(token)).toBeGreaterThan(TTL_HOURS - 1);
    expect(response.headers.get('set-cookie')).toContain(
      `tasktab_session=${token}`,
    );
  });

  it('nao reescreve a sessao que ainda esta na primeira metade', async () => {
    // Renovar a cada requisicao seria uma escrita no banco por clique.
    const token = await insertSession(currentUser().id, undefined, {
      hours: TTL_HOURS - 10,
    });

    const response = await request('GET', '/api/auth/me', undefined, {
      token,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await sessionHoursLeft(token)).toBeLessThan(TTL_HOURS - 9);
  });
});
