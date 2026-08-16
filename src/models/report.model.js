'use strict';

const db = require('../config/database');

const COLUMNS = `id, title, period_start, period_end, advance_cents, status, created_at, updated_at`;

// Colunas que o cliente pode alterar via update parcial.
const UPDATABLE_COLUMNS = [
  'title',
  'period_start',
  'period_end',
  'advance_cents',
  'status',
];

async function findAll({ status, limit = 50, offset = 0 } = {}) {
  const params = [];
  let sql = `SELECT ${COLUMNS} FROM reports`;

  if (status) {
    params.push(status);
    sql += ` WHERE status = $${params.length}`;
  }

  params.push(limit);
  sql += ` ORDER BY period_start DESC, id DESC LIMIT $${params.length}`;

  params.push(offset);
  sql += ` OFFSET $${params.length}`;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function count({ status } = {}) {
  const params = [];
  let sql = 'SELECT COUNT(*)::int AS total FROM reports';

  if (status) {
    params.push(status);
    sql += ` WHERE status = $${params.length}`;
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
  status,
}) {
  const { rows } = await db.query(
    `INSERT INTO reports (title, period_start, period_end, advance_cents, status)
     VALUES (
       $1,
       $2::date,
       $3::date,
       COALESCE($4, 0),
       COALESCE($5::report_status, 'open'::report_status)
     )
     RETURNING ${COLUMNS}`,
    [title, period_start, period_end, advance_cents ?? null, status || null],
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
