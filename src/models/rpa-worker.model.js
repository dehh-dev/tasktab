'use strict';

const db = require('../config/database');

const COLUMNS = `id, launch_id, number, cpf, name, role, starts_on, left_on,
  promoted_since, dependents, email, rg, rg_issued_on, birth_date, birth_place,
  pis, address, district, city, cep, mother_name, father_name, bank_code,
  bank_name, agency, bank_operation, account, account_type, pix_key_type,
  pix_key, form_submitted_at, issues, created_at, updated_at`;

// O que o PATCH pode mudar. `launch_id` e `number` ficam de fora: o numero e
// fixo na pessoa e vai no codigo de todo RPA dela. `issues` e
// `form_submitted_at` so a importacao e o proprio PATCH escrevem, pelo
// `update` abaixo.
const UPDATABLE_COLUMNS = [
  'name',
  'cpf',
  'role',
  'starts_on',
  'left_on',
  'promoted_since',
  'dependents',
  'email',
  'rg',
  'rg_issued_on',
  'birth_date',
  'birth_place',
  'pis',
  'address',
  'district',
  'city',
  'cep',
  'mother_name',
  'father_name',
  'bank_code',
  'bank_name',
  'agency',
  'bank_operation',
  'account',
  'account_type',
  'pix_key_type',
  'pix_key',
];

const WRITABLE = [...UPDATABLE_COLUMNS, 'form_submitted_at', 'issues'];

// O que a retencao apaga um mes depois de encerrar (decisao de 2026-11-01).
// Ficam nome e CPF, que estao no codigo e no historico dos RPAs, e o que e do
// trabalho: funcao, datas e dependentes.
const PERSONAL_COLUMNS = [
  'email',
  'rg',
  'rg_issued_on',
  'birth_date',
  'birth_place',
  'pis',
  'address',
  'district',
  'city',
  'cep',
  'mother_name',
  'father_name',
  'bank_code',
  'bank_name',
  'agency',
  'bank_operation',
  'account',
  'account_type',
  'pix_key_type',
  'pix_key',
];

function valueOf(column, value) {
  return column === 'issues' ? JSON.stringify(value ?? []) : (value ?? null);
}

async function findByLaunch(launchId, client = db) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM rpa_workers WHERE launch_id = $1 ORDER BY number`,
    [launchId],
  );
  return rows;
}

/**
 * So o que a grade do ponto usa: sem CPF, conta e documento, que a grade nao
 * mostra e que nao precisam sair do banco a cada abertura dela.
 */
async function findRoster(launchId) {
  const { rows } = await db.query(
    `SELECT id, number, name, role, starts_on, left_on, promoted_since
     FROM rpa_workers WHERE launch_id = $1 ORDER BY number`,
    [launchId],
  );
  return rows;
}

async function findById(id) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM rpa_workers WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function findByCpf(launchId, cpf) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM rpa_workers WHERE launch_id = $1 AND cpf = $2`,
    [launchId, cpf],
  );
  return rows[0] || null;
}

/** O proximo numero fixo do lancamento: quem entra depois ganha o seguinte. */
async function nextNumber(client, launchId) {
  const { rows } = await client.query(
    'SELECT COALESCE(MAX(number), 0) + 1 AS next FROM rpa_workers WHERE launch_id = $1',
    [launchId],
  );
  return rows[0].next;
}

async function insert(client, launchId, number, data) {
  const columns = WRITABLE.filter((column) =>
    Object.prototype.hasOwnProperty.call(data, column),
  );
  const values = columns.map((column) => valueOf(column, data[column]));
  const placeholders = columns.map((column, index) =>
    column === 'issues' ? `$${index + 3}::jsonb` : `$${index + 3}`,
  );

  const { rows } = await client.query(
    `INSERT INTO rpa_workers (launch_id, number, ${columns.join(', ')})
     VALUES ($1, $2, ${placeholders.join(', ')})
     RETURNING ${COLUMNS}`,
    [launchId, number, ...values],
  );
  return rows[0];
}

async function update(id, data, client = db) {
  const assignments = [];
  const params = [];

  for (const column of WRITABLE) {
    if (Object.prototype.hasOwnProperty.call(data, column)) {
      params.push(valueOf(column, data[column]));
      const cast = column === 'issues' ? '::jsonb' : '';
      assignments.push(`${column} = $${params.length}${cast}`);
    }
  }

  if (assignments.length === 0) {
    return findById(id);
  }

  // `updated_at` fica por conta do trigger rpa_workers_set_updated_at.
  params.push(id);

  const { rows } = await client.query(
    `UPDATE rpa_workers SET ${assignments.join(', ')}
     WHERE id = $${params.length}
     RETURNING ${COLUMNS}`,
    params,
  );
  return rows[0] || null;
}

/** A retencao: os dados pessoais da equipe inteira viram nulo. */
async function erasePersonalData(client, launchId) {
  const { rowCount } = await client.query(
    `UPDATE rpa_workers
     SET ${PERSONAL_COLUMNS.map((column) => `${column} = NULL`).join(', ')},
         issues = '[]'
     WHERE launch_id = $1`,
    [launchId],
  );
  return rowCount;
}

module.exports = {
  UPDATABLE_COLUMNS,
  PERSONAL_COLUMNS,
  erasePersonalData,
  findByLaunch,
  findRoster,
  findById,
  findByCpf,
  nextNumber,
  insert,
  update,
};
