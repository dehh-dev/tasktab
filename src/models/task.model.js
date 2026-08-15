'use strict';

const db = require('../config/database');

const COLUMNS = `id, title, description, status, due_date, created_at, updated_at`;

// Colunas que o cliente pode alterar via update parcial.
const UPDATABLE_COLUMNS = ['title', 'description', 'status', 'due_date'];

async function findAll({ status, limit = 50, offset = 0 } = {}) {
  const params = [];
  let sql = `SELECT ${COLUMNS} FROM tasks`;

  if (status) {
    params.push(status);
    sql += ` WHERE status = $${params.length}`;
  }

  params.push(limit);
  sql += ` ORDER BY created_at DESC, id DESC LIMIT $${params.length}`;

  params.push(offset);
  sql += ` OFFSET $${params.length}`;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function count({ status } = {}) {
  const params = [];
  let sql = 'SELECT COUNT(*)::int AS total FROM tasks';

  if (status) {
    params.push(status);
    sql += ` WHERE status = $${params.length}`;
  }

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

async function create({ title, description = null, status, due_date = null }) {
  const { rows } = await db.query(
    `INSERT INTO tasks (title, description, status, due_date)
     VALUES ($1, $2, COALESCE($3::task_status, 'pending'::task_status), $4::date)
     RETURNING ${COLUMNS}`,
    [title, description, status || null, due_date],
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
