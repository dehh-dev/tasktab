'use strict';

const {
  request,
  insertUser,
  DEFAULT_USER,
  DEFAULT_PASSWORD,
} = require('../../orchestrator');

describe('POST /api/auth/login', () => {
  it('abre a sessao e devolve o usuario com os escopos', async () => {
    const response = await request(
      'POST',
      '/api/auth/login',
      { email: DEFAULT_USER.email, password: DEFAULT_PASSWORD },
      { token: null },
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      email: DEFAULT_USER.email,
      role: 'admin',
    });
    expect(response.body.data.scopes).toContain('reports:read:any');
  });

  it('nunca devolve o hash da senha', async () => {
    const response = await request(
      'POST',
      '/api/auth/login',
      { email: DEFAULT_USER.email, password: DEFAULT_PASSWORD },
      { token: null },
    );

    expect(response.body.data.password_hash).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('scrypt');
  });

  it('grava o cookie de sessao como httpOnly e SameSite=Lax', async () => {
    const response = await request(
      'POST',
      '/api/auth/login',
      { email: DEFAULT_USER.email, password: DEFAULT_PASSWORD },
      { token: null },
    );

    const cookie = response.headers.get('set-cookie');

    // HttpOnly mantem o token fora do alcance de qualquer script da pagina, e
    // SameSite=Lax e o que dispensa token de CSRF nesta API.
    expect(cookie).toContain('tasktab_session=');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('o cookie devolvido de fato autentica as requisicoes seguintes', async () => {
    const login = await request(
      'POST',
      '/api/auth/login',
      { email: DEFAULT_USER.email, password: DEFAULT_PASSWORD },
      { token: null },
    );

    const token = /tasktab_session=([^;]+)/.exec(
      login.headers.get('set-cookie'),
    )[1];

    const response = await request('GET', '/api/auth/me', undefined, { token });

    expect(response.status).toBe(200);
    expect(response.body.data.email).toBe(DEFAULT_USER.email);
  });

  it('responde 401 com senha errada', async () => {
    const response = await request(
      'POST',
      '/api/auth/login',
      { email: DEFAULT_USER.email, password: 'senha-que-nao-e-a-certa' },
      { token: null },
    );

    expect(response.status).toBe(401);
    expect(response.body.name).toBe('UnauthorizedError');
    expect(response.body.action).toBeTruthy();
  });

  it('responde a mesma coisa para e-mail inexistente e senha errada', async () => {
    // Distinguir os dois casos transformaria o login num verificador de quem
    // tem conta no sistema.
    const senhaErrada = await request(
      'POST',
      '/api/auth/login',
      { email: DEFAULT_USER.email, password: 'senha-que-nao-e-a-certa' },
      { token: null },
    );

    const semCadastro = await request(
      'POST',
      '/api/auth/login',
      { email: 'ninguem@tasktab.test', password: 'senha-que-nao-e-a-certa' },
      { token: null },
    );

    expect(semCadastro.status).toBe(senhaErrada.status);
    expect(semCadastro.body.message).toBe(senhaErrada.body.message);
  });

  it('aceita o e-mail em maiusculas', async () => {
    const response = await request(
      'POST',
      '/api/auth/login',
      { email: DEFAULT_USER.email.toUpperCase(), password: DEFAULT_PASSWORD },
      { token: null },
    );

    expect(response.status).toBe(200);
  });

  it('recusa corpo sem e-mail ou senha com 422 por campo', async () => {
    const response = await request(
      'POST',
      '/api/auth/login',
      {},
      { token: null },
    );

    expect(response.status).toBe(422);
    expect(response.body.details.map((detail) => detail.field).sort()).toEqual([
      'email',
      'password',
    ]);
  });

  it('nao aceita a sessao de um usuario que foi apagado', async () => {
    // A sessao referencia o usuario com ON DELETE CASCADE: apagar a pessoa
    // derruba na hora tudo que estava aberto em nome dela.
    const outro = await insertUser({
      email: 'temporario@tasktab.test',
      role: 'user',
    });

    const login = await request(
      'POST',
      '/api/auth/login',
      { email: outro.email, password: DEFAULT_PASSWORD },
      { token: null },
    );

    const token = /tasktab_session=([^;]+)/.exec(
      login.headers.get('set-cookie'),
    )[1];

    await request('DELETE', `/api/users/${outro.id}`);

    const response = await request('GET', '/api/auth/me', undefined, { token });

    expect(response.status).toBe(401);
  });
});
