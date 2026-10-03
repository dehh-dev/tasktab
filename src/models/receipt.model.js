'use strict';

const db = require('../config/database');

const COLUMNS = `id, report_id, merchant_id, file_path, file_hash, page_number,
                 issued_at, amount_cents, category, category_guessed, access_key,
                 issuer_name, issuer_city, rotation, status, extraction_source,
                 confidence, raw_text, duplicate_of_id, created_at, updated_at`;

/** As colunas com o alias da tabela, para consulta com JOIN. */
function prefixed(alias) {
  return COLUMNS.split(',')
    .map((column) => `${alias}.${column.trim()}`)
    .join(', ');
}

// Colunas que a revisao pode corrigir. `report_id`, `file_hash` e
// `page_number` ficam de fora de proposito: sao a identidade da pagina.
const UPDATABLE_COLUMNS = [
  'merchant_id',
  'issued_at',
  'amount_cents',
  'category',
  'category_guessed',
  'access_key',
  'issuer_name',
  'issuer_city',
  'rotation',
  'status',
  'extraction_source',
  'confidence',
  'duplicate_of_id',
];

// Nome e cidade de quem emitiu: os do cadastro, quando o comprovante tem
// emitente, e os do proprio papel quando nao tem — o recibo manuscrito sem
// CNPJ. Um lugar so, para a lista, a revisao e as tres saidas nao divergirem.
const ISSUER_NAME = 'COALESCE(m.name, r.issuer_name)';
const ISSUER_CITY = 'COALESCE(m.city, r.issuer_city)';

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

  // O emitente vem junto: a lista e o dialogo de exclusao mostram o nome, e a
  // revisao precisa da categoria do cadastro para oferecer atualiza-la.
  const { rows } = await db.query(
    `SELECT ${prefixed('r')},
            ${ISSUER_NAME} AS merchant_name,
            m.default_category AS merchant_default_category
     FROM receipts r
     LEFT JOIN merchants m ON m.id = r.merchant_id
     WHERE ${conditions.map((condition) => `r.${condition}`).join(' AND ')}
     ORDER BY r.issued_at, r.page_number, r.id`,
    params,
  );

  return rows;
}

/**
 * Total e somatorio por categoria, em centavos.
 *
 * O total ja inclui o que esta em revisao: quem revisa quer ver para onde a
 * prestacao vai, e o valor lido aparece somado desde a extracao. Duplicata
 * fica de fora — continua listada e vai no PDF consolidado, mas somar as duas
 * era exatamente o erro que a ferramenta existe para evitar.
 *
 * A categoria so soma o confirmado. A de quem ainda esta em revisao e palpite
 * da extracao, e distribuir o valor por um palpite faria o subtotal de um tipo
 * mudar sozinho a cada correcao — decisao de quem usa: o valor em revisao vai
 * para o total, sem categoria.
 */
async function summarizeByReport(reportId, { status, category } = {}) {
  const params = [reportId];
  const conditions = [
    'report_id = $1',
    ...buildFilters({ status, category }, params),
  ];

  // GROUPING separa a linha do ROLLUP do grupo dos comprovantes sem
  // categoria: os dois chegam com `category` nulo, e todo upload cria
  // comprovante sem categoria. Qual dos dois valia dependia da ordem das
  // linhas.
  const { rows } = await db.query(
    `SELECT
       GROUPING(category) = 1 AS is_total,
       category,
       COUNT(*)::int AS total,
       COALESCE(SUM(amount_cents) FILTER (WHERE status <> 'duplicate'), 0)::int
         AS total_cents,
       COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
       COALESCE(SUM(amount_cents) FILTER (WHERE status = 'confirmed'), 0)::int
         AS confirmed_cents
     FROM receipts
     WHERE ${conditions.join(' AND ')}
     GROUP BY ROLLUP (category)`,
    params,
  );

  const totals = { total: 0, total_cents: 0, by_category: {} };

  for (const row of rows) {
    if (row.is_total) {
      totals.total = row.total;
      totals.total_cents = row.total_cents;
    } else if (row.category !== null && row.confirmed > 0) {
      totals.by_category[row.category] = row.confirmed_cents;
    }
  }

  return totals;
}

/**
 * Comprovantes de um relatorio para exportacao, com nome e cidade do
 * emitente ja resolvidos.
 *
 * Ordem cronologica com `id` como desempate — nenhum parser extrai hora do
 * comprovante ainda, entao nao ha como desempatar por hora como o backlog
 * pede. Registrado como limitacao conhecida, nao como o comportamento ideal.
 */
async function findForExport(reportId) {
  const { rows } = await db.query(
    `SELECT r.id, r.issued_at, r.amount_cents, r.category, r.status,
            r.duplicate_of_id, r.access_key, r.file_path, r.page_number,
            r.rotation,
            ${ISSUER_NAME} AS merchant_name, ${ISSUER_CITY} AS merchant_city
     FROM receipts r
     LEFT JOIN merchants m ON m.id = r.merchant_id
     WHERE r.report_id = $1
     ORDER BY r.issued_at NULLS LAST, r.id`,
    [reportId],
  );
  return rows;
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

// Colunas que a extracao escreve. Separadas de UPDATABLE_COLUMNS de proposito:
// aquela lista e a superficie que o cliente pode tocar na revisao, esta e a
// que o pipeline preenche. Misturar as duas deixaria `raw_text` editavel por
// PATCH, o que apagaria a trilha de auditoria.
const EXTRACTION_COLUMNS = [
  'raw_text',
  'status',
  'extraction_source',
  'issued_at',
  'amount_cents',
  'category',
  'category_guessed',
  'access_key',
  'issuer_name',
  'issuer_city',
  'confidence',
  'merchant_id',
  'duplicate_of_id',
];

async function applyExtraction(id, data) {
  const assignments = [];
  const params = [];

  for (const column of EXTRACTION_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(data, column)) {
      params.push(data[column]);
      assignments.push(`${column} = $${params.length}`);
    }
  }

  if (assignments.length === 0) {
    return findById(id);
  }

  params.push(id);

  const { rows } = await db.query(
    `UPDATE receipts SET ${assignments.join(', ')}
     WHERE id = $${params.length}
     RETURNING ${COLUMNS}`,
    params,
  );

  return rows[0] || null;
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

/**
 * Arquivos referenciados por um relatorio, sem repetir: o PDF e gravado uma vez
 * por hash e todas as paginas dele apontam para o mesmo nome.
 *
 * Levantar isso antes de apagar o relatorio e o que permite limpar o disco — a
 * cascata da FK leva os comprovantes junto e depois nao ha mais como saber o
 * que estava anexado.
 */
async function findFilesByReport(reportId) {
  const { rows } = await db.query(
    'SELECT DISTINCT file_hash, file_path FROM receipts WHERE report_id = $1',
    [reportId],
  );
  return rows;
}

/** Quantas linhas ainda apontam para o arquivo — em qualquer relatorio. */
async function countByHash(fileHash) {
  const { rows } = await db.query(
    'SELECT COUNT(*)::int AS total FROM receipts WHERE file_hash = $1',
    [fileHash],
  );
  return rows[0].total;
}

// Devolve a linha, nao um booleano: quem chama precisa do arquivo que ela
// referenciava para decidir se o PDF ainda tem dono no disco.
async function remove(id) {
  const { rows } = await db.query(
    'DELETE FROM receipts WHERE id = $1 RETURNING id, file_hash, file_path',
    [id],
  );
  return rows[0] || null;
}

module.exports = {
  COLUMNS,
  UPDATABLE_COLUMNS,
  findByReport,
  summarizeByReport,
  findForExport,
  findById,
  findByReportAndHash,
  findFilesByReport,
  countByHash,
  createPages,
  applyExtraction,
  update,
  remove,
};
