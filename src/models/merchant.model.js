'use strict';

const db = require('../config/database');

const COLUMNS = `id, cnpj, name, default_category, city, created_at, updated_at`;

const UPDATABLE_COLUMNS = ['name', 'default_category', 'city'];

async function findAll({ limit = 50, offset = 0 } = {}) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM merchants ORDER BY name, id LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows;
}

async function count() {
  const { rows } = await db.query(
    'SELECT COUNT(*)::int AS total FROM merchants',
  );
  return rows[0].total;
}

async function findById(id) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM merchants WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function findByCnpj(cnpj) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM merchants WHERE cnpj = $1`,
    [cnpj],
  );
  return rows[0] || null;
}

async function create({ cnpj, name, default_category, city }) {
  const { rows } = await db.query(
    `INSERT INTO merchants (cnpj, name, default_category, city)
     VALUES (
       $1,
       $2,
       COALESCE($3::expense_category, 'nao_classificado'::expense_category),
       $4
     )
     RETURNING ${COLUMNS}`,
    [cnpj, name, default_category || null, city ?? null],
  );
  return rows[0];
}

/**
 * Cria o emitente, ou devolve o que ja existe com aquele CNPJ.
 *
 * A extracao encontra o mesmo emitente varias vezes no mesmo lote — 7 dos 28
 * lancamentos do caso-base eram do mesmo CNPJ. Tratar isso como conflito faria
 * o pipeline falhar no caminho mais comum.
 */
async function findOrCreate({ cnpj, name, default_category, city }) {
  const { rows } = await db.query(
    `INSERT INTO merchants (cnpj, name, default_category, city)
     VALUES (
       $1,
       $2,
       COALESCE($3::expense_category, 'nao_classificado'::expense_category),
       $4
     )
     ON CONFLICT (cnpj) DO NOTHING
     RETURNING ${COLUMNS}`,
    [cnpj, name, default_category || null, city ?? null],
  );

  return rows[0] || findByCnpj(cnpj);
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

  // `updated_at` fica por conta do trigger merchants_set_updated_at.
  params.push(id);

  const { rows } = await db.query(
    `UPDATE merchants SET ${assignments.join(', ')}
     WHERE id = $${params.length}
     RETURNING ${COLUMNS}`,
    params,
  );

  return rows[0] || null;
}

module.exports = {
  findAll,
  count,
  findById,
  findByCnpj,
  create,
  findOrCreate,
  update,
};
