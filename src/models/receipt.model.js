'use strict';

const db = require('../config/database');

const COLUMNS = `id, report_id, merchant_id, file_path, file_hash, page_number,
                 issued_at, amount_cents, category, access_key, status,
                 extraction_source, confidence, raw_text, duplicate_of_id,
                 created_at, updated_at`;

// Colunas que a revisao pode corrigir. `report_id`, `file_hash` e
// `page_number` ficam de fora de proposito: sao a identidade da pagina.
const UPDATABLE_COLUMNS = [
  'merchant_id',
  'issued_at',
  'amount_cents',
  'category',
  'access_key',
  'status',
  'extraction_source',
  'confidence',
  'duplicate_of_id',
];

function buildFilters({ status, category }, params) {
  const conditions = [];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }

  return conditions;
}

async function findByReport(reportId, { status, category } = {}) {
  const params = [reportId];
  const conditions = [
    'report_id = $1',
    ...buildFilters({ status, category }, params),
  ];

  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM receipts
     WHERE ${conditions.join(' AND ')}
     ORDER BY issued_at, page_number, id`,
    params,
  );

  return rows;
}

/**
 * Total e somatorio por categoria, em centavos.
 *
 * Duplicata fica de fora da soma — continua listada e vai no PDF consolidado,
 * mas somar as duas era exatamente o erro que a ferramenta existe para evitar.
 */
async function summarizeByReport(reportId, { status, category } = {}) {
  const params = [reportId];
  const conditions = [
    'report_id = $1',
    ...buildFilters({ status, category }, params),
  ];

  const { rows } = await db.query(
    `SELECT
       COUNT(*)::int AS total,
       COALESCE(SUM(amount_cents) FILTER (WHERE status <> 'duplicate'), 0)::int
         AS total_cents,
       category,
       COALESCE(SUM(amount_cents) FILTER (WHERE status <> 'duplicate'), 0)::int
         AS category_cents
     FROM receipts
     WHERE ${conditions.join(' AND ')}
     GROUP BY ROLLUP (category)`,
    params,
  );

  const totals = { total: 0, total_cents: 0, by_category: {} };

  for (const row of rows) {
    if (row.category === null) {
      totals.total = row.total;
      totals.total_cents = row.total_cents;
    } else {
      totals.by_category[row.category] = row.category_cents;
    }
  }

  return totals;
}

async function findById(id) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM receipts WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function findByReportAndHash(reportId, fileHash) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM receipts
     WHERE report_id = $1 AND file_hash = $2
     ORDER BY page_number`,
    [reportId, fileHash],
  );
  return rows;
}

/** Cria uma linha por pagina do arquivo. */
async function createPages({ reportId, filePath, fileHash, pages, status }) {
  const values = [];
  const params = [reportId, filePath, fileHash, status || 'pending'];

  for (const page of pages) {
    params.push(page.pageNumber, page.rawText ?? null);
    values.push(`($1, $2, $3, $${params.length - 1}, $4, $${params.length})`);
  }

  const { rows } = await db.query(
    `INSERT INTO receipts (report_id, file_path, file_hash, page_number, status, raw_text)
     VALUES ${values.join(', ')}
     RETURNING ${COLUMNS}`,
    params,
  );

  return rows;
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

  // `updated_at` fica por conta do trigger receipts_set_updated_at.
  params.push(id);

  const { rows } = await db.query(
    `UPDATE receipts SET ${assignments.join(', ')}
     WHERE id = $${params.length}
     RETURNING ${COLUMNS}`,
    params,
  );

  return rows[0] || null;
}

async function remove(id) {
  const { rows } = await db.query(
    'DELETE FROM receipts WHERE id = $1 RETURNING id',
    [id],
  );
  return rows.length > 0;
}

module.exports = {
  COLUMNS,
  UPDATABLE_COLUMNS,
  findByReport,
  summarizeByReport,
  findById,
  findByReportAndHash,
  createPages,
  update,
  remove,
};
