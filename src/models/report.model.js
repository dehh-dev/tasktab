'use strict';

const db = require('../config/database');

const COLUMNS = `id, title, period_start, period_end, advance_cents, main_city,
                 status, owner_id, created_at, updated_at`;

// Colunas que o cliente pode alterar via update parcial. `owner_id` fica de
// fora: transferir a posse de um relatorio nao pode acontecer por um PATCH que
// passou por acaso — seria a forma mais silenciosa de burlar a autorizacao.
const UPDATABLE_COLUMNS = [
  'title',
  'period_start',
  'period_end',
  'advance_cents',
  'main_city',
  'status',
];

/**
 * `ownerId` indefinido significa **sem filtro de dono**, e e o que o
 * controller passa para quem tem `reports:read:any`. Relatorio de dono nulo
 * (legado, anterior aos usuarios) cai fora do filtro naturalmente: `owner_id =
 * $1` nunca casa com NULL.
 */
function buildOwnerFilter(ownerId, params, conditions) {
  if (ownerId !== undefined) {
    params.push(ownerId);
    conditions.push(`owner_id = $${params.length}`);
  }
}

async function findAll({ status, ownerId, limit = 50, offset = 0 } = {}) {
  const params = [];
  const conditions = [];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  buildOwnerFilter(ownerId, params, conditions);

  let sql = `SELECT ${COLUMNS} FROM reports`;

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }

  params.push(limit);
  sql += ` ORDER BY period_start DESC, id DESC LIMIT $${params.length}`;

  params.push(offset);
  sql += ` OFFSET $${params.length}`;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function count({ status, ownerId } = {}) {
  const params = [];
  const conditions = [];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  buildOwnerFilter(ownerId, params, conditions);

  let sql = 'SELECT COUNT(*)::int AS total FROM reports';

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }

  const { rows } = await db.query(sql, params);
  return rows[0].total;
}

async function findById(id) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM reports WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function create({
  title,
  period_start,
  period_end,
  advance_cents,
  main_city,
  status,
  owner_id,
}) {
  // Adiantamento que nao veio fica nulo: e "nao informado", e o zero ficou
  // para "nao houve adiantamento" (issue 44).
  const { rows } = await db.query(
    `INSERT INTO reports
       (title, period_start, period_end, advance_cents, main_city, status,
        owner_id)
     VALUES (
       $1,
       $2::date,
       $3::date,
       $4,
       $5,
       COALESCE($6::report_status, 'open'::report_status),
       $7
     )
     RETURNING ${COLUMNS}`,
    [
      title,
      period_start,
      period_end,
      advance_cents ?? null,
      main_city ?? null,
      status || null,
      owner_id ?? null,
    ],
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

  // `updated_at` fica por conta do trigger reports_set_updated_at.
  params.push(id);

  const { rows } = await db.query(
    `UPDATE reports SET ${assignments.join(', ')}
     WHERE id = $${params.length}
     RETURNING ${COLUMNS}`,
    params,
  );
  return rows[0] || null;
}

async function remove(id) {
  const { rows } = await db.query(
    'DELETE FROM reports WHERE id = $1 RETURNING id',
    [id],
  );
  return rows.length > 0;
}

module.exports = { findAll, count, findById, create, update, remove };
