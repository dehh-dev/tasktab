'use strict';

const db = require('../config/database');

const COLUMNS = `id, report_id, merchant_id, file_path, file_hash, page_number,
                 issued_at, amount_cents, category, access_key, status,
                 extraction_source, confidence, raw_text, duplicate_of_id,
                 created_at, updated_at`;

async function findByReportAndHash(reportId, fileHash) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM receipts
     WHERE report_id = $1 AND file_hash = $2
     ORDER BY page_number`,
    [reportId, fileHash],
  );
  return rows;
}

/** Cria uma linha por pagina do arquivo, numa transacao so. */
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

module.exports = { COLUMNS, findByReportAndHash, createPages };
