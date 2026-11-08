'use strict';

const db = require('../config/database');

const COLUMNS = `id, title, description, status, due_date, reference,
  created_at, updated_at`;

// Colunas que o cliente pode alterar via update parcial.
const UPDATABLE_COLUMNS = [
  'title',
  'description',
  'status',
  'due_date',
  'reference',
];

/**
 * O WHERE da listagem e da contagem, com os mesmos filtros nas duas. A busca
 * `q` (issue 74) acha o texto no titulo ou na referencia, sem caixa; `%` e
 * `_` digitados valem como texto, e nao como curinga do LIKE.
 */
function where({ status, q }, params) {
  const conditions = [];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
    conditions.push(
      `(title ILIKE $${params.length} OR reference ILIKE $${params.length})`,
    );
  }

  return conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
}

async function findAll({ status, q, limit = 50, offset = 0 } = {}) {
  const params = [];
  let sql = `SELECT ${COLUMNS} FROM tasks${where({ status, q }, params)}`;

  // O que vence primeiro no topo, sem prazo no fim (issue 74): sete tarefas
  // criadas no mesmo minuto saiam em ordem aleatoria para quem quer saber o
  // que vence antes. No mesmo prazo, a mais nova; o indice em due_date ja
  // existe.
  params.push(limit);
  sql += ` ORDER BY due_date ASC NULLS LAST, created_at DESC, id DESC LIMIT $${params.length}`;

  params.push(offset);
  sql += ` OFFSET $${params.length}`;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function count({ status, q } = {}) {
  const params = [];
  const sql = `SELECT COUNT(*)::int AS total FROM tasks${where({ status, q }, params)}`;

  const { rows } = await db.query(sql, params);
  return rows[0].total;
}

async function findById(id) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM tasks WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function create({
  title,
  description = null,
  status,
  due_date = null,
  reference = null,
}) {
  const { rows } = await db.query(
    `INSERT INTO tasks (title, description, status, due_date, reference)
     VALUES ($1, $2, COALESCE($3::task_status, 'pending'::task_status), $4::date, $5)
     RETURNING ${COLUMNS}`,
    [title, description, status || null, due_date, reference],
  );
  return rows[0];
}

async function update(id, data) {
  const assignments = [];
  const params = [];

  for (const column of UPDATABLE_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(data, column)) {
      params.push(data[column]);
      assignments.push(`${column} = $${params.length}`);
    }
  }

  if (assignments.length === 0) {
    return findById(id);
  }

  // `updated_at` fica por conta do trigger tasks_set_updated_at: assim vale
  // tambem para escrita que nao passa por aqui.
  params.push(id);

  const { rows } = await db.query(
    `UPDATE tasks SET ${assignments.join(', ')}
     WHERE id = $${params.length}
     RETURNING ${COLUMNS}`,
    params,
  );
  return rows[0] || null;
}

async function remove(id) {
  const { rows } = await db.query(
    'DELETE FROM tasks WHERE id = $1 RETURNING id',
    [id],
  );
  return rows.length > 0;
}

module.exports = { findAll, count, findById, create, update, remove };
