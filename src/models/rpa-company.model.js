'use strict';

const db = require('../config/database');

const COLUMNS = `id, code, name, cnpj, city, state, service_type, cost_center,
  created_at, updated_at`;

// O codigo UAU fica de fora: e a identidade da empresa e vai no codigo de
// todo RPA emitido para ela.
const UPDATABLE_COLUMNS = [
  'name',
  'cnpj',
  'city',
  'state',
  'service_type',
  'cost_center',
];

async function findAll({ limit = 50, offset = 0 } = {}) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM rpa_companies ORDER BY code LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows;
}

async function count() {
  const { rows } = await db.query(
    'SELECT COUNT(*)::int AS total FROM rpa_companies',
  );
  return rows[0].total;
}

async function findById(id) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM rpa_companies WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function findByCode(code) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM rpa_companies WHERE code = $1`,
    [code],
  );
  return rows[0] || null;
}

async function create(data) {
  const { rows } = await db.query(
    `INSERT INTO rpa_companies
       (code, name, cnpj, city, state, service_type, cost_center)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNS}`,
    [
      data.code,
      data.name,
      data.cnpj,
      data.city ?? null,
      data.state ?? null,
      data.service_type ?? null,
      data.cost_center ?? null,
    ],
  );
  return rows[0];
}

/**
 * Cria pelo codigo UAU, ou atualiza a que ja existe. E o caminho do script
 * que le a aba EMPRESA.
 *
 * Tipo de servico e centro de custo so sobrescrevem quando a planilha os
 * traz: na de Avare vinham vazios para a 815, e reimportar nao pode apagar o
 * que alguem ja preencheu aqui. `inserted` diz qual dos dois aconteceu.
 */
async function upsertByCode(data) {
  const { rows } = await db.query(
    `INSERT INTO rpa_companies
       (code, name, cnpj, city, state, service_type, cost_center)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name,
       cnpj = EXCLUDED.cnpj,
       city = EXCLUDED.city,
       state = EXCLUDED.state,
       service_type = COALESCE(EXCLUDED.service_type, rpa_companies.service_type),
       cost_center = COALESCE(EXCLUDED.cost_center, rpa_companies.cost_center)
     RETURNING ${COLUMNS}, (xmax = 0) AS inserted`,
    [
      data.code,
      data.name,
      data.cnpj,
      data.city ?? null,
      data.state ?? null,
      data.service_type ?? null,
      data.cost_center ?? null,
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

  // `updated_at` fica por conta do trigger rpa_companies_set_updated_at.
  params.push(id);

  const { rows } = await db.query(
    `UPDATE rpa_companies SET ${assignments.join(', ')}
     WHERE id = $${params.length}
     RETURNING ${COLUMNS}`,
    params,
  );

  return rows[0] || null;
}

module.exports = {
  UPDATABLE_COLUMNS,
  findAll,
  count,
  findById,
  findByCode,
  create,
  upsertByCode,
  update,
};
