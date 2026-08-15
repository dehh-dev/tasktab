'use strict';

const { execSync } = require('child_process');
const path = require('path');
const db = require('../src/config/database');
const env = require('../src/config/env');

const ROOT = path.resolve(__dirname, '..');
const BASE_URL = `http://localhost:${env.port}`;

const MAX_ATTEMPTS = 40;
const RETRY_DELAY_MS = 250;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** URL absoluta da API, para que os testes falem HTTP de verdade. */
function apiUrl(pathname) {
  return `${BASE_URL}${pathname}`;
}

/**
 * Espera o servidor responder no /api/health. O `npm test` sobe a API em
 * paralelo ao Jest, entao a suite nao pode assumir que ela ja esta no ar.
 */
async function waitForWebServer() {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(apiUrl('/api/health'));

      if (response.status === 200) {
        return;
      }

      lastError = new Error(`resposta inesperada: ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(RETRY_DELAY_MS);
  }

  throw new Error(
    `A API nao respondeu em ${BASE_URL} apos ${MAX_ATTEMPTS} tentativas.\n` +
      `Ultimo erro: ${lastError && lastError.message}`,
  );
}

async function waitForAllServices() {
  await waitForWebServer();
}

/** Aplica as migrations pendentes no banco de teste. */
function runPendingMigrations() {
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
        'esta no ar (`npm run services:up`) e se o banco tasktab_test existe.' +
        `\n\n${output}`,
    );
  }
}

function clearDatabase() {
  return db.query('TRUNCATE TABLE tasks RESTART IDENTITY');
}

function closeDatabase() {
  return db.close();
}

/**
 * Insere uma task direto no banco, sem passar pela API. Manter o arranjo fora
 * da rota evita que um teste de leitura quebre por causa de um bug na escrita.
 */
async function insertTask(overrides = {}) {
  const task = {
    title: 'Tarefa de teste',
    description: null,
    status: 'pending',
    due_date: null,
    ...overrides,
  };

  const { rows } = await db.query(
    `INSERT INTO tasks (title, description, status, due_date)
     VALUES ($1, $2, $3, $4)
     RETURNING id, title, description, status, due_date, created_at, updated_at`,
    [task.title, task.description, task.status, task.due_date],
  );

  return rows[0];
}

/**
 * Requisicao HTTP real contra a API. Um `body` string e enviado cru, o que
 * permite testar payload malformado.
 */
async function request(method, pathname, body) {
  const response = await fetch(apiUrl(pathname), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body:
      body === undefined
        ? undefined
        : typeof body === 'string'
          ? body
          : JSON.stringify(body),
  });

  const text = await response.text();

  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null,
  };
}

module.exports = {
  apiUrl,
  waitForAllServices,
  runPendingMigrations,
  clearDatabase,
  closeDatabase,
  insertTask,
  request,
};
