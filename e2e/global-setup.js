'use strict';

process.env.NODE_ENV = 'test';

const { execFileSync } = require('child_process');
const path = require('path');
const orchestrator = require('../tests/orchestrator');
const { E2E_USER } = require('./constants');

const ROOT = path.resolve(__dirname, '..');

/**
 * Prepara o banco de teste antes da suite de E2E, reaproveitando o mesmo
 * orchestrator da suite de API. Os servidores sao levantados pelo `webServer`
 * do playwright.config.js.
 *
 * O usuario do E2E e criado pelo mesmo script de linha de comando que cria o
 * primeiro usuario de verdade — nao ha um segundo caminho de cadastro so para
 * o teste. Ele roda num subprocesso: um pool do `pg` aberto aqui prenderia o
 * processo do Playwright no fim da suite, que e a mesma razao pela qual o
 * arranjo das specs passa pela API publica.
 */
module.exports = async function globalSetup() {
  orchestrator.runPendingMigrations();
  await orchestrator.closeDatabase();

  execFileSync(
    'node',
    [
      'scripts/create-user.js',
      '--email',
      E2E_USER.email,
      '--name',
      E2E_USER.name,
      '--role',
      E2E_USER.role,
      '--password',
      E2E_USER.password,
      // A suite roda de novo sobre um banco que ja tem o usuario da execucao
      // anterior; sem isto a segunda execucao falharia por e-mail repetido.
      '--replace',
    ],
    { cwd: ROOT, env: { ...process.env, NODE_ENV: 'test' }, stdio: 'pipe' },
  );
};
