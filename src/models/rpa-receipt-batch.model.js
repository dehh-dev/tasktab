'use strict';

const db = require('../config/database');

/**
 * O envio dos recibos assinados (issue 42): o PDF escaneado e o andamento da
 * leitura na fila, de `pending` a `done` (com o resultado) ou `failed`.
 */
const COLUMNS = `id, launch_id, payment_number, file_hash, file_path,
  page_count, status, result, error, created_by, created_at, updated_at`;

/** O PDF lido e cada arquivo enviado (`sources`) contam como referencia. */
async function countByHash(fileHash) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total FROM rpa_receipt_batches
     WHERE file_hash = $1
        OR sources @> jsonb_build_array(jsonb_build_object('file_hash', $1::text))`,
    [fileHash],
  );
  return rows[0].total;
}

async function create(data) {
  const { rows } = await db.query(
    `INSERT INTO rpa_receipt_batches
       (launch_id, payment_number, file_hash, file_path, page_count,
        sources, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNS}`,
    [
      data.launch_id,
      data.payment_number,
      data.file_hash,
      data.file_path,
      data.page_count,
      JSON.stringify(data.sources ?? []),
      data.created_by,
    ],
  );
  return rows[0];
}

async function findById(id) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM rpa_receipt_batches WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

/**
 * So o que ainda esta pendente vira `processing`: a fila nao le duas vezes.
 * Traz `sources`, que fica fora da resposta da API (caminhos no disco).
 */
async function start(id) {
  const { rows } = await db.query(
    `UPDATE rpa_receipt_batches SET status = 'processing'
     WHERE id = $1 AND status = 'pending'
     RETURNING ${COLUMNS}, sources`,
    [id],
  );
  return rows[0] || null;
}

async function finish(id, result) {
  await db.query(
    `UPDATE rpa_receipt_batches SET status = 'done', result = $2 WHERE id = $1`,
    [id, JSON.stringify(result)],
  );
}

async function fail(id, error) {
  await db.query(
    `UPDATE rpa_receipt_batches SET status = 'failed', error = $2 WHERE id = $1`,
    [id, error],
  );
}

module.exports = { countByHash, create, findById, start, finish, fail };
