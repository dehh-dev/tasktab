'use strict';

const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/**
 * Roda as migrations no banco de teste antes da suite. As variaveis vem de
 * env.test (carregado por src/config/env), incluindo DATABASE_URL que o
 * node-pg-migrate consome.
 */
module.exports = function globalSetup() {
  process.env.NODE_ENV = 'test';
  require('../src/config/env');

  try {
    execSync('npx node-pg-migrate --envPath env.test up', {
      cwd: ROOT,
      env: process.env,
      stdio: 'pipe',
    });
  } catch (error) {
    const output = [error.stdout, error.stderr]
      .filter(Boolean)
      .map((buffer) => buffer.toString())
      .join('\n');

    throw new Error(
      'Nao foi possivel preparar o banco de teste. Confira se o Postgres ' +
        'esta no ar (`npm run db:up`) e se o banco tasktab_test existe.\n\n' +
        output,
    );
  }
};
