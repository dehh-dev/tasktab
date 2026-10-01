'use strict';

const crypto = require('crypto');

const {
  request,
  insertUser,
  DEFAULT_USER,
  DEFAULT_PASSWORD,
  currentUser,
  updateColumnDirectly,
  findPasswordHash,
} = require('../../orchestrator');
const { COST } = require('../../../src/services/auth/password');

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

  it('entra mesmo com um cookie de sessao malformado no navegador', async () => {
    // O login e a saida de quem tem um cookie ruim: se ele tambem caisse, a
    // pessoa so se livraria do problema limpando os cookies na mao.
    const response = await request(
      'POST',
      '/api/auth/login',
      { email: DEFAULT_USER.email, password: DEFAULT_PASSWORD },
      { token: '%E0%A4%A' },
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

  it('hash que a KDF recusa e 500, nao "senha incorreta"', async () => {
    // N precisa ser potencia de 2: o scrypt recusa 1000 com
    // ERR_CRYPTO_INVALID_SCRYPT_PARAMS. O defeito e do registro, e responder
    // 401 mandaria a pessoa repetir a senha certa ate o limitador bloquear.
    await updateColumnDirectly(
      'users',
      currentUser().id,
      'password_hash',
      'scrypt$1000$8$1$c2FsdA==$aGFzaA==',
    );

    const response = await request(
      'POST',
      '/api/auth/login',
      { email: DEFAULT_USER.email, password: DEFAULT_PASSWORD },
      { token: null },
    );

    expect(response.status).toBe(500);
    expect(response.body.name).toBe('InternalServerError');
  });

  it('refaz o hash de quem entra com o formato antigo, sem pepper e com outro custo', async () => {
    // Hash valido da senha padrao, sem pepper e com N=1024: um registro
    // gravado antes do pepper e de o custo subir.
    const salt = crypto.randomBytes(16);
    const derived = crypto.scryptSync(DEFAULT_PASSWORD, salt, 64, {
      N: 1024,
      r: 8,
      p: 1,
    });
    const id = currentUser().id;
    await updateColumnDirectly(
      'users',
      id,
      'password_hash',
      `scrypt$1024$8$1$${salt.toString('base64')}$${derived.toString('base64')}`,
    );

    const response = await request(
      'POST',
      '/api/auth/login',
      { email: DEFAULT_USER.email, password: DEFAULT_PASSWORD },
      { token: null },
    );

    expect(response.status).toBe(200);
    expect(await findPasswordHash(id)).toMatch(
      new RegExp(`^scrypt-hmac\\$${COST.N}\\$${COST.r}\\$${COST.p}\\$`),
    );
  });

  it('o pepper entra no hash: o mesmo calculo sem ele nao abre a sessao', async () => {
    const id = currentUser().id;
    const salt = crypto.randomBytes(16);
    const stored = (input) =>
      [
        'scrypt-hmac',
        COST.N,
        COST.r,
        COST.p,
        salt.toString('base64'),
        crypto
          .scryptSync(input, salt, 64, { N: COST.N, r: COST.r, p: COST.p })
          .toString('base64'),
      ].join('$');
    const hmac = crypto
      .createHmac('sha256', process.env.PASSWORD_PEPPER)
      .update(DEFAULT_PASSWORD)
      .digest();

    const statusWith = async (hash) => {
      await updateColumnDirectly('users', id, 'password_hash', hash);
      const response = await request(
        'POST',
        '/api/auth/login',
        { email: DEFAULT_USER.email, password: DEFAULT_PASSWORD },
        { token: null },
      );
      return response.status;
    };

    // O controle positivo e o que garante que o 401 vem da falta do pepper, e
    // nao de um hash montado errado no proprio teste.
    expect({
      comPepper: await statusWith(stored(hmac)),
      semPepper: await statusWith(stored(DEFAULT_PASSWORD)),
    }).toEqual({ comPepper: 200, semPepper: 401 });
  });
});
