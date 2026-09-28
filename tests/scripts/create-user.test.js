'use strict';

const {
  request,
  runScript,
  insertUser,
  createUserWithSession,
  DEFAULT_USER,
} = require('../orchestrator');

function createUser(...args) {
  return runScript('scripts/create-user.js', args);
}

describe('npm run users:create', () => {
  it('cadastra com senha sorteada, e a senha impressa serve para entrar', async () => {
    const result = createUser(
      '--email',
      'Nova@Tasktab.test',
      '--name',
      'Nova Pessoa',
      '--role',
      'auditor',
    );

    expect(result.status).toBe(0);

    const [, generatedPassword] = /Senha sorteada: (\S+)/.exec(result.stdout);
    const login = await request(
      'POST',
      '/api/auth/login',
      { email: 'nova@tasktab.test', password: generatedPassword },
      { token: null },
    );

    expect(login.status).toBe(200);
    expect(login.body.data.role).toBe('auditor');
  });

  it('aplica a mesma regra de senha da API', () => {
    const result = createUser(
      '--email',
      'curta@tasktab.test',
      '--name',
      'Senha Curta',
      '--password',
      'curta',
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('password deve ter ao menos 10 caracteres');
  });

  it('recusa e-mail ja cadastrado sem --replace', () => {
    const result = createUser(
      '--email',
      DEFAULT_USER.email,
      '--name',
      'Outra Pessoa',
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--replace');
  });
});

describe('npm run users:create -- --replace', () => {
  it('troca a senha e encerra as sessoes abertas da pessoa', async () => {
    // Redefinir pelo script e o caminho de quem recupera uma conta, as vezes
    // comprometida: quem estava dentro nao pode continuar dentro.
    const { user, token } = await createUserWithSession({ role: 'user' });

    const result = createUser(
      '--email',
      user.email,
      '--name',
      user.name,
      '--password',
      'senha-nova-e-forte',
      '--replace',
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Sessoes encerradas: 1');

    const oldSession = await request('GET', '/api/auth/me', undefined, {
      token,
    });
    expect(oldSession.status).toBe(401);

    const login = await request(
      'POST',
      '/api/auth/login',
      { email: user.email, password: 'senha-nova-e-forte' },
      { token: null },
    );
    expect(login.status).toBe(200);
  });

  it('sem --role mantem o papel de quem ja existia', async () => {
    // Redefinir a senha de um administrador nao pode rebaixa-lo de quebra: se
    // ele for o unico, o sistema fica sem quem cadastre pessoas.
    const admin = await insertUser({
      name: 'Chefe',
      email: 'chefe@tasktab.test',
      role: 'admin',
    });

    const result = createUser(
      '--email',
      admin.email,
      '--name',
      admin.name,
      '--replace',
    );

    expect(result.status).toBe(0);

    const response = await request('GET', `/api/users/${admin.id}`);
    expect(response.body.data.role).toBe('admin');
  });
});
