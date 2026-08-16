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

/**
 * Aplica as migrations pendentes no banco de teste.
 *
 * Custa um processo `npx`, entao roda **uma vez por execucao**, chamada pelo
 * `globalSetup` do Jest — nao por arquivo de teste. Deduplicar com uma marca
 * em `process.env` nao funcionaria: o ambiente de teste do Jest entrega a cada
 * arquivo a sua propria copia de `process.env`.
 */
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

/**
 * Espera a fila de extracao do servidor esvaziar.
 *
 * A fila vive no processo da API, nao no do Jest: sem esperar, o trabalho
 * enfileirado por um teste continua rodando depois do TRUNCATE do proximo e
 * reinsere emitentes no meio da execucao seguinte. Foi assim que apareceu.
 */
async function waitForQueue({ timeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await fetch(apiUrl('/api/health')).catch(() => null);

    if (response && response.status === 200) {
      const { data } = await response.json();

      if (!data.queue || data.queue.pending === 0) {
        return;
      }
    }

    await sleep(50);
  }

  throw new Error(`A fila de extracao nao esvaziou em ${timeoutMs}ms.`);
}

// CASCADE porque receipts referencia reports e merchants; sem ele o TRUNCATE
// recusa a tabela que tem dependente.
function clearDatabase() {
  return db.query(
    'TRUNCATE TABLE tasks, receipts, reports, merchants RESTART IDENTITY CASCADE',
  );
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

/** Insere um relatorio direto no banco, sem passar pela API. */
async function insertReport(overrides = {}) {
  const report = {
    title: 'Viagem de teste',
    period_start: '2026-06-01',
    period_end: '2026-06-30',
    advance_cents: 0,
    status: 'open',
    ...overrides,
  };

  const { rows } = await db.query(
    `INSERT INTO reports (title, period_start, period_end, advance_cents, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, title, period_start, period_end, advance_cents, status,
               created_at, updated_at`,
    [
      report.title,
      report.period_start,
      report.period_end,
      report.advance_cents,
      report.status,
    ],
  );

  return rows[0];
}

/** Insere um comprovante direto no banco, sem passar pela API. */
async function insertReceipt(reportId, overrides = {}) {
  const receipt = {
    file_path: 'fixture.pdf',
    file_hash: 'a'.repeat(64),
    page_number: 1,
    issued_at: null,
    amount_cents: null,
    category: null,
    status: 'pending',
    access_key: null,
    raw_text: null,
    merchant_id: null,
    ...overrides,
  };

  const { rows } = await db.query(
    `INSERT INTO receipts
       (report_id, file_path, file_hash, page_number, issued_at, amount_cents,
        category, status, access_key, raw_text, merchant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, report_id, file_path, file_hash, page_number, issued_at,
               amount_cents, category, status, access_key, extraction_source,
               updated_at`,
    [
      reportId,
      receipt.file_path,
      receipt.file_hash,
      receipt.page_number,
      receipt.issued_at,
      receipt.amount_cents,
      receipt.category,
      receipt.status,
      receipt.access_key,
      receipt.raw_text,
      receipt.merchant_id,
    ],
  );

  return rows[0];
}

/** Insere um emitente direto no banco, sem passar pela API. */
async function insertMerchant(overrides = {}) {
  const merchant = {
    cnpj: '26048802000165',
    name: 'Franguinho na Panela',
    default_category: 'nao_classificado',
    city: null,
    ...overrides,
  };

  const { rows } = await db.query(
    `INSERT INTO merchants (cnpj, name, default_category, city)
     VALUES ($1, $2, $3, $4)
     RETURNING id, cnpj, name, default_category, city, updated_at`,
    [merchant.cnpj, merchant.name, merchant.default_category, merchant.city],
  );

  return rows[0];
}

/**
 * Atualiza uma task direto no banco, sem passar pela API nem pelo model. Serve
 * para provar o que e garantia do banco: repare que `updated_at` nao aparece
 * no SQL abaixo.
 */
async function updateTaskTitleDirectly(id, title) {
  const { rows } = await db.query(
    `UPDATE tasks SET title = $1 WHERE id = $2
     RETURNING id, title, updated_at`,
    [title, id],
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

/**
 * Envio multipart, para as rotas de upload. O `fetch` monta o boundary sozinho
 * a partir do FormData — definir Content-Type na mao quebraria isso.
 */
async function requestUpload(pathname, files) {
  const form = new FormData();

  for (const { buffer, filename } of files) {
    form.append(
      'files',
      new Blob([buffer], { type: 'application/pdf' }),
      filename,
    );
  }

  const response = await fetch(apiUrl(pathname), {
    method: 'POST',
    body: form,
  });
  const text = await response.text();

  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null,
  };
}

/**
 * Espera a fila de extracao terminar com as paginas do relatorio.
 *
 * O upload responde 202 e o processamento segue em segundo plano, entao todo
 * teste que afirma algo sobre o conteudo extraido precisa passar por aqui.
 */
async function waitForProcessing(reportId, { timeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS pendentes FROM receipts
       WHERE report_id = $1 AND status IN ('pending', 'processing')`,
      [reportId],
    );

    if (rows[0].pendentes === 0) {
      return;
    }

    await sleep(50);
  }

  throw new Error(
    `A extracao do relatorio ${reportId} nao terminou em ${timeoutMs}ms.`,
  );
}

/**
 * Requisicao HTTP para resposta binaria (xlsx, pdf). `request()` sempre faz
 * `JSON.parse` no corpo, o que quebra para esses content-types.
 */
async function requestBinary(method, pathname) {
  const response = await fetch(apiUrl(pathname), { method });
  const buffer = Buffer.from(await response.arrayBuffer());

  return { status: response.status, headers: response.headers, buffer };
}

/** Le os receipts de um relatorio direto do banco, na ordem de pagina. */
async function findReceipts(reportId) {
  const { rows } = await db.query(
    `SELECT id, report_id, file_path, file_hash, page_number, status, raw_text
     FROM receipts WHERE report_id = $1
     ORDER BY file_hash, page_number`,
    [reportId],
  );
  return rows;
}

module.exports = {
  apiUrl,
  waitForAllServices,
  runPendingMigrations,
  clearDatabase,
  closeDatabase,
  insertTask,
  insertReport,
  insertReceipt,
  insertMerchant,
  updateTaskTitleDirectly,
  findReceipts,
  waitForProcessing,
  waitForQueue,
  request,
  requestUpload,
  requestBinary,
};
