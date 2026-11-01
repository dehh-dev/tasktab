'use strict';

const db = require('../config/database');

/**
 * Documentos do formulario e recibos assinados do RPA (issues 41 e 42).
 *
 * A contagem por hash e o que a retencao precisa para nao apagar do disco um
 * arquivo que o RPA ainda referencia.
 */
async function countByHash(fileHash) {
  const { rows } = await db.query(
    'SELECT COUNT(*)::int AS total FROM rpa_files WHERE file_hash = $1',
    [fileHash],
  );
  return rows[0].total;
}

/**
 * Os arquivos de um lancamento, levantados **antes** de apaga-lo: a cascata da
 * FK leva as linhas, e depois nao ha mais como saber o que estava no disco.
 */
async function findFilesByLaunch(launchId) {
  // O PDF dos recibos (issue 42) e cada arquivo enviado com ele dividem o
  // diretorio tambem.
  const { rows } = await db.query(
    `SELECT file_hash, file_path FROM rpa_files WHERE launch_id = $1
     UNION
     SELECT file_hash, file_path FROM rpa_receipt_batches WHERE launch_id = $1
     UNION
     SELECT source ->> 'file_hash', source ->> 'file_path'
     FROM rpa_receipt_batches b, jsonb_array_elements(b.sources) source
     WHERE b.launch_id = $1`,
    [launchId],
  );
  return rows;
}

const DOCUMENT_COLUMNS = `f.id, f.launch_id, f.worker_id,
  w.number AS worker_number, w.name AS worker_name, f.kind, f.side,
  f.content_type, f.byte_size, f.source_name, f.created_at, f.updated_at`;

/**
 * Os documentos do formulario do lancamento, pela pessoa; os sem pessoa no
 * fim. O recibo assinado (issue 42) fica de fora: e do pagamento.
 */
async function findDocuments(launchId, { withPath = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${DOCUMENT_COLUMNS}${withPath ? ', f.file_path' : ''}
     FROM rpa_files f LEFT JOIN rpa_workers w ON w.id = f.worker_id
     WHERE f.launch_id = $1 AND f.kind <> 'signed_receipt'
     ORDER BY w.number NULLS LAST, f.kind, f.side NULLS FIRST, f.id`,
    [launchId],
  );
  return rows;
}

async function findById(id) {
  const { rows } = await db.query(
    `SELECT ${DOCUMENT_COLUMNS}
     FROM rpa_files f LEFT JOIN rpa_workers w ON w.id = f.worker_id
     WHERE f.id = $1`,
    [id],
  );
  return rows[0] || null;
}

/**
 * Grava os documentos do .zip, um por hash no lancamento: reenviar o mesmo
 * .zip nao duplica. Do arquivo que ja estava, so a pessoa e preenchida, e so
 * se faltava — a escolha feita na mao nao e desfeita.
 */
async function insertDocuments(launchId, files) {
  if (files.length === 0) return { created: 0, assigned: 0 };

  const column = (name) => files.map((file) => file[name]);
  const { rows } = await db.query(
    `INSERT INTO rpa_files
       (launch_id, worker_id, kind, side, file_hash, file_path, content_type,
        byte_size, source_name)
     SELECT $1, * FROM unnest($2::int[], $3::rpa_file_kind[],
                              $4::rpa_document_side[], $5::varchar[],
                              $6::text[], $7::varchar[], $8::int[],
                              $9::varchar[])
     ON CONFLICT (launch_id, file_hash) DO UPDATE
       SET worker_id = EXCLUDED.worker_id
       WHERE rpa_files.worker_id IS NULL AND EXCLUDED.worker_id IS NOT NULL
     RETURNING (xmax = 0) AS created`,
    [
      launchId,
      column('worker_id'),
      column('kind'),
      column('side'),
      column('file_hash'),
      column('file_path'),
      column('content_type'),
      column('byte_size'),
      column('source_name'),
    ],
  );

  const created = rows.filter((row) => row.created).length;
  return { created, assigned: rows.length - created };
}

/**
 * Os recibos separados (issue 42), uma pagina por pessoa, ligados ao
 * pagamento. A pagina separada do mesmo PDF da o mesmo arquivo: reenviar nao
 * duplica.
 */
async function insertReceipts(launchId, receipts) {
  if (receipts.length === 0) return;

  const column = (name) => receipts.map((receipt) => receipt[name]);
  await db.query(
    `INSERT INTO rpa_files
       (launch_id, worker_id, payment_id, kind, file_hash, file_path,
        content_type, byte_size)
     SELECT $1, worker_id, payment_id, 'signed_receipt', file_hash, file_path,
            'application/pdf', byte_size
     FROM unnest($2::int[], $3::int[], $4::varchar[], $5::text[], $6::int[])
          AS r(worker_id, payment_id, file_hash, file_path, byte_size)
     ON CONFLICT (launch_id, file_hash) DO NOTHING`,
    [
      launchId,
      column('worker_id'),
      column('payment_id'),
      column('file_hash'),
      column('file_path'),
      column('byte_size'),
    ],
  );
}

/** Os recibos do n-esimo pagamento, com o nome do cadastro, pela pessoa. */
async function findReceipts(launchId, number) {
  const { rows } = await db.query(
    `SELECT f.id, f.file_path, f.payment_id, w.number AS worker_number,
            w.name AS worker_name, p.code
     FROM rpa_files f
     JOIN rpa_payments p ON p.id = f.payment_id
     JOIN rpa_workers w ON w.id = f.worker_id
     WHERE f.launch_id = $1 AND f.kind = 'signed_receipt'
       AND p.number = $2 AND p.status <> 'canceled'
     ORDER BY w.number, f.id`,
    [launchId, number],
  );
  return rows;
}

const UPDATABLE_COLUMNS = ['worker_id', 'kind', 'side'];

async function update(id, data) {
  const assignments = [];
  const params = [];

  for (const column of UPDATABLE_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(data, column)) {
      params.push(data[column]);
      assignments.push(`${column} = $${params.length}`);
    }
  }

  params.push(id);
  await db.query(
    `UPDATE rpa_files SET ${assignments.join(', ')} WHERE id = $${params.length}`,
    params,
  );
  return findById(id);
}

/**
 * A retencao: documentos e recibos do lancamento saem, com o PDF dos envios
 * de recibos (que guarda nome, CPF e valor lidos). Devolve os arquivos, para
 * o disco ser limpo depois do commit.
 */
async function deleteByLaunch(client, launchId) {
  const { rows } = await client.query(
    `WITH files AS (
       DELETE FROM rpa_files WHERE launch_id = $1
       RETURNING file_hash, file_path
     ), batches AS (
       DELETE FROM rpa_receipt_batches WHERE launch_id = $1
       RETURNING file_hash, file_path, sources
     )
     SELECT * FROM files
     UNION SELECT file_hash, file_path FROM batches
     UNION SELECT source ->> 'file_hash', source ->> 'file_path'
           FROM batches, jsonb_array_elements(batches.sources) source`,
    [launchId],
  );
  return rows;
}

module.exports = {
  UPDATABLE_COLUMNS,
  countByHash,
  findFilesByLaunch,
  deleteByLaunch,
  findDocuments,
  findById,
  insertDocuments,
  insertReceipts,
  findReceipts,
  update,
};
