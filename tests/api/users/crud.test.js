'use strict';

const {
  request,
  insertUser,
  createUserWithSession,
  currentUser,
  DEFAULT_PASSWORD,
} = require('../../orchestrator');

const NOVO = {
  name: 'Ana Prestadora',
  email: 'ana@tasktab.test',
  password: 'senha-bem-comprida',
};

describe('POST /api/users', () => {
  it('cadastra e devolve 201 sem o hash da senha', async () => {
    const response = await request('POST', '/api/users', NOVO);

    expect(response.status).toBe(201);
    expect(response.headers.get('location')).toBe(
      `/api/users/${response.body.data.id}`,
    );
    expect(response.body.data).toMatchObject({
      name: NOVO.name,
      email: NOVO.email,
      role: 'user',
    });
    expect(response.body.data.password_hash).toBeUndefined();
  });

  it('normaliza o e-mail para minusculas', async () => {
    const response = await request('POST', '/api/users', {
      ...NOVO,
      email: 'ANA@TaskTab.Test',
    });

    expect(response.body.data.email).toBe('ana@tasktab.test');
  });

  it('a senha cadastrada de fato serve para entrar', async () => {
    await request('POST', '/api/users', NOVO);

    const login = await request(
      'POST',
      '/api/auth/login',
      { email: NOVO.email, password: NOVO.password },
      { token: null },
    );

    expect(login.status).toBe(200);
  });

  it('recusa e-mail repetido com 422 no campo', async () => {
    await request('POST', '/api/users', NOVO);
    const response = await request('POST', '/api/users', NOVO);

    expect(response.status).toBe(422);
    expect(response.body.details[0].field).toBe('email');
  });

  it('recusa senha curta demais', async () => {
    const response = await request('POST', '/api/users', {
      ...NOVO,
      password: 'curta',
    });

    expect(response.status).toBe(422);
    expect(response.body.details[0].field).toBe('password');
  });

  it.each([
    ['email', 'sem arroba', { email: 'ana.tasktab.test' }],
    ['email', 'em branco', { email: '  ' }],
    ['name', 'em branco', { name: '   ' }],
    ['name', 'que nao e texto', { name: 42 }],
  ])('recusa %s %s com 422 no campo', async (campo, caso, override) => {
    const response = await request('POST', '/api/users', {
      ...NOVO,
      ...override,
    });

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      expect.objectContaining({ field: campo }),
    ]);
  });

  it('recusa papel fora do enum', async () => {
    const response = await request('POST', '/api/users', {
      ...NOVO,
      role: 'superusuario',
    });

    expect(response.status).toBe(422);
    expect(response.body.details[0].field).toBe('role');
  });
});

describe('GET /api/users', () => {
  it('lista com meta e sem hash de senha', async () => {
    await insertUser({ email: 'outra@tasktab.test', role: 'user' });

    const response = await request('GET', '/api/users');

    expect(response.status).toBe(200);
    expect(response.body.meta.total).toBe(2);
    expect(JSON.stringify(response.body)).not.toContain('scrypt');
  });
});

describe('GET /api/users/:id', () => {
  it('deixa qualquer pessoa consultar o proprio cadastro', async () => {
    const { user, token } = await createUserWithSession({ role: 'user' });
    const response = await request('GET', `/api/users/${user.id}`, undefined, {
      token,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(user.id);
  });
});

describe('PATCH /api/users/:id', () => {
  it('altera o proprio nome sem precisar de users:write', async () => {
    const { user, token } = await createUserWithSession({ role: 'user' });

    const response = await request(
      'PATCH',
      `/api/users/${user.id}`,
      { name: 'Nome Novo' },
      { token },
    );

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('Nome Novo');
  });

  it('impede promover a si mesmo', async () => {
    // A escalada de privilegio mais comum que existe: o proprio cadastro e
    // editavel, e o papel viajaria junto se ninguem separasse os dois.
    const { user, token } = await createUserWithSession({ role: 'user' });

    const response = await request(
      'PATCH',
      `/api/users/${user.id}`,
      { role: 'admin' },
      { token },
    );

    expect(response.status).toBe(422);
    expect(response.body.details[0].field).toBe('role');

    const depois = await request('GET', `/api/users/${user.id}`);
    expect(depois.body.data.role).toBe('user');
  });

  it('um administrador altera o papel de outra pessoa', async () => {
    const { user } = await createUserWithSession({ role: 'user' });

    const response = await request('PATCH', `/api/users/${user.id}`, {
      role: 'auditor',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.role).toBe('auditor');
  });

  it('recusa trocar o e-mail por esta rota', async () => {
    const response = await request('PATCH', `/api/users/${currentUser().id}`, {
      email: 'outro@tasktab.test',
    });

    expect(response.status).toBe(422);
    expect(response.body.details[0].field).toBe('email');
  });
});

describe('PATCH /api/users/:id — senha', () => {
  it('exige a senha atual para trocar a propria', async () => {
    const { user, token } = await createUserWithSession({ role: 'user' });

    const response = await request(
      'PATCH',
      `/api/users/${user.id}`,
      { password: 'uma-senha-nova-longa' },
      { token },
    );

    expect(response.status).toBe(422);
    expect(response.body.details[0].field).toBe('current_password');
  });

  it('troca a propria senha com a atual confirmada', async () => {
    const { user, token } = await createUserWithSession({ role: 'user' });

    const response = await request(
      'PATCH',
      `/api/users/${user.id}`,
      {
        password: 'uma-senha-nova-longa',
        current_password: DEFAULT_PASSWORD,
      },
      { token },
    );

    expect(response.status).toBe(200);

    const login = await request(
      'POST',
      '/api/auth/login',
      { email: user.email, password: 'uma-senha-nova-longa' },
      { token: null },
    );

    expect(login.status).toBe(200);
  });

  it('a troca derruba as outras sessoes e poupa a corrente', async () => {
    // Se a senha vazou, quem a usou continuaria dentro ate o token vencer.
    const { user, token } = await createUserWithSession({ role: 'user' });
    const outraSessao = await request(
      'POST',
      '/api/auth/login',
      { email: user.email, password: DEFAULT_PASSWORD },
      { token: null },
    );

    const outroToken = /tasktab_session=([^;]+)/.exec(
      outraSessao.headers.get('set-cookie'),
    )[1];

    await request(
      'PATCH',
      `/api/users/${user.id}`,
      {
        password: 'uma-senha-nova-longa',
        current_password: DEFAULT_PASSWORD,
      },
      { token },
    );

    const derrubada = await request('GET', '/api/auth/me', undefined, {
      token: outroToken,
    });
    expect(derrubada.status).toBe(401);

    const corrente = await request('GET', '/api/auth/me', undefined, { token });
    expect(corrente.status).toBe(200);
  });

  it('um administrador redefine a senha alheia sem saber a atual', async () => {
    const { user } = await createUserWithSession({ role: 'user' });

    const response = await request('PATCH', `/api/users/${user.id}`, {
      password: 'senha-redefinida-pelo-admin',
    });

    expect(response.status).toBe(200);
  });
});

describe('DELETE /api/users/:id', () => {
  it('remove e responde 204', async () => {
    const alvo = await insertUser({ email: 'alvo@tasktab.test', role: 'user' });

    const response = await request('DELETE', `/api/users/${alvo.id}`);

    expect(response.status).toBe(204);
    expect((await request('GET', `/api/users/${alvo.id}`)).status).toBe(404);
  });

  it('recusa apagar o proprio usuario', async () => {
    const response = await request('DELETE', `/api/users/${currentUser().id}`);

    expect(response.status).toBe(422);
    expect(response.body.details[0].field).toBe('id');
  });

  it('recusa apagar o unico administrador', async () => {
    // Sem esta regra o sistema fica sem quem cadastre pessoas, e o unico
    // conserto seria um UPDATE direto no banco.
    const outroAdmin = await insertUser({
      email: 'admin2@tasktab.test',
      role: 'admin',
    });

    // Com dois admins, apagar um e permitido.
    expect(
      (await request('DELETE', `/api/users/${outroAdmin.id}`)).status,
    ).toBe(204);

    // O ultimo nao pode ser rebaixado, o que fecharia a porta por dentro.
    const rebaixar = await request('PATCH', `/api/users/${currentUser().id}`, {
      role: 'user',
    });

    expect(rebaixar.status).toBe(422);
    expect(rebaixar.body.details[0].message).toContain('unico administrador');
  });
});
