'use strict';

const { Client } = require('pg');
const env = require('../src/config/env');

const MAX_ATTEMPTS = 30;
const RETRY_DELAY_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Uma tentativa de conexao real com o banco da aplicacao. Vai alem do
 * "container subiu": valida credenciais e a existencia do database, que e o
 * que de fato as migrations e a suite precisam.
 */
async function tryConnect() {
  const client = new Client({
    host: env.database.host,
    port: env.database.port,
    user: env.database.user,
    password: env.database.password,
    database: env.database.name,
    connectionTimeoutMillis: 2000,
  });

  try {
    await client.connect();
    await client.query('SELECT 1');
  } finally {
    await client.end().catch(() => {});
  }
}

async function waitForPostgres() {
  process.stdout.write(
    `Aguardando Postgres em ${env.database.host}:${env.database.port}/${env.database.name} `,
  );

  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await tryConnect();
      process.stdout.write(' pronto!\n');
      return;
    } catch (error) {
      lastError = error;
      process.stdout.write('.');
      await sleep(RETRY_DELAY_MS);
    }
  }

  process.stdout.write('\n');
  throw new Error(
    `Postgres nao respondeu apos ${MAX_ATTEMPTS} tentativas. ` +
      `Verifique se os servicos estao no ar (npm run services:up).\n` +
      `Ultimo erro: ${lastError && lastError.message}`,
  );
}

waitForPostgres().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
