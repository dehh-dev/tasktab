'use strict';

const db = require('../config/database');

/**
 * Os RPAs emitidos (issue 39). O banco trava o emitido
 * (`lock-issued-rpa-payments`): aqui so se insere e se cancela.
 *
 * Emitir a equipe inteira sao tres INSERTs com `unnest` (pagamentos, dias e
 * ajustes), qualquer que seja o tamanho dela.
 */
const COLUMNS = `p.id, p.worker_id, w.number AS worker_number,
  w.name AS worker_name, w.launch_id, p.number, p.code, p.period_start,
  p.period_end, p.payment_date, p.net_cents, p.inss_cents, p.irrf_cents,
  p.gross_cents, p.irrf_base_cents, p.dependents, p.inss_table_id,
  p.irrf_table_id, p.status, p.issued_at, p.paid_at, p.canceled_at,
  p.cancel_reason, p.created_by, p.created_at, p.updated_at`;

const FROM = 'FROM rpa_payments p JOIN rpa_workers w ON w.id = p.worker_id';

function listFilter({ launchId, status, number }) {
  const params = [launchId];
  const where = ['w.launch_id = $1'];

  if (status) {
    params.push(status);
    where.push(`p.status = $${params.length}`);
  }

  if (number) {
    params.push(number);
    where.push(`p.number = $${params.length}`);
  }

  return { params, where: `WHERE ${where.join(' AND ')}` };
}

async function findByLaunch({ launchId, status, number, limit, offset }) {
  const filter = listFilter({ launchId, status, number });
  const { rows } = await db.query(
    `SELECT ${COLUMNS} ${FROM} ${filter.where}
     ORDER BY p.number, w.number, p.id
     LIMIT $${filter.params.length + 1} OFFSET $${filter.params.length + 2}`,
    [...filter.params, limit, offset],
  );
  return rows;
}

async function count(query) {
  const filter = listFilter(query);
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total ${FROM} ${filter.where}`,
    filter.params,
  );
  return rows[0].total;
}

/** O RPA com o que levou de cada dia e os acrescimos e descontos. */
async function findById(id) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS},
       COALESCE((
         SELECT json_agg(json_build_object(
                  'date', d.work_date,
                  'part', d.part,
                  'value_subcents', d.value_subcents,
                  'voided', d.voided)
                ORDER BY d.work_date, d.part)
         FROM rpa_payment_days d WHERE d.payment_id = p.id
       ), '[]') AS lines,
       COALESCE((
         SELECT json_agg(json_build_object(
                  'kind', a.kind,
                  'amount_cents', a.amount_cents,
                  'reason', a.reason)
                ORDER BY a.id)
         FROM rpa_payment_adjustments a WHERE a.payment_id = p.id
       ), '[]') AS adjustments
     ${FROM} WHERE p.id = $1`,
    [id],
  );
  return rows[0] || null;
}

/**
 * O que os pagamentos validos ja levaram de cada dia da equipe, por parte. A
 * soma vem como texto (bigint) e volta inteira: cabe com folga no `Number`.
 */
async function ledgerByLaunch(launchId, client = db) {
  const { rows } = await client.query(
    `SELECT d.worker_id, d.work_date, d.part,
            SUM(d.value_subcents)::text AS value_subcents
     FROM rpa_payment_days d JOIN rpa_workers w ON w.id = d.worker_id
     WHERE w.launch_id = $1 AND NOT d.voided
     GROUP BY d.worker_id, d.work_date, d.part`,
    [launchId],
  );
  return rows.map((row) => ({
    ...row,
    value_subcents: Number(row.value_subcents),
  }));
}

/** Os numeros ja usados por pessoa, fora os cancelados. */
async function numbersByWorkers(workerIds, client = db) {
  const { rows } = await client.query(
    `SELECT worker_id, array_agg(number ORDER BY number) AS numbers
     FROM rpa_payments
     WHERE worker_id = ANY($1::int[]) AND status <> 'canceled'
     GROUP BY worker_id`,
    [workerIds],
  );
  return rows;
}

/**
 * O acumulado do mes por CPF na mesma fonte pagadora (o CNPJ da empresa), em
 * qualquer lancamento: o teto do INSS e o IRRF sao do mes, e nao de cada RPA.
 */
async function monthTotals({ cnpj, cpfs, paymentDate }, client = db) {
  const { rows } = await client.query(
    `SELECT w.cpf,
            SUM(p.gross_cents)::int AS gross_cents,
            SUM(p.inss_cents)::int AS inss_cents,
            SUM(p.irrf_cents)::int AS irrf_cents,
            SUM(p.irrf_base_cents)::int AS irrf_base_cents
     FROM rpa_payments p
     JOIN rpa_workers w ON w.id = p.worker_id
     JOIN rpa_launches l ON l.id = w.launch_id
     JOIN rpa_companies c ON c.id = l.company_id
     WHERE c.cnpj = $1 AND w.cpf = ANY($2::varchar[])
       AND p.status <> 'canceled'
       AND date_trunc('month', p.payment_date)
           = date_trunc('month', $3::date)
     GROUP BY w.cpf`,
    [cnpj, cpfs, paymentDate],
  );
  return rows;
}

/**
 * Os codigos que ja sao de um RPA valido. O numero da pessoa recomeca em cada
 * lancamento, e dois lancamentos da mesma empresa no mesmo mes dariam o
 * mesmo `no-empresa-pessoa-mmaaaa`.
 */
async function takenCodes(codes, client = db) {
  const { rows } = await client.query(
    `SELECT code FROM rpa_payments
     WHERE code = ANY($1::varchar[]) AND status <> 'canceled'`,
    [codes],
  );
  return rows.map((row) => row.code);
}

/** As tabelas de INSS e IRRF vigentes na data: a de maior inicio ate ela. */
async function taxTables(date, client = db) {
  const { rows } = await client.query(
    `SELECT DISTINCT ON (kind) id, kind, starts_on, legal_basis, inss_rate_bp,
            inss_ceiling_cents, irrf_brackets, irrf_simplified_discount_cents,
            irrf_dependent_deduction_cents, irrf_reduction
     FROM rpa_tax_tables
     WHERE starts_on <= $1
     ORDER BY kind, starts_on DESC`,
    [date],
  );
  return {
    inss: rows.find((row) => row.kind === 'inss') ?? null,
    irrf: rows.find((row) => row.kind === 'irrf') ?? null,
  };
}

/** Grava os RPAs e devolve `{ id, worker_id }`: cada pessoa aparece uma vez. */
async function insertMany(client, payments, createdBy) {
  const column = (name) => payments.map((payment) => payment[name]);
  const { rows } = await client.query(
    `INSERT INTO rpa_payments
       (worker_id, number, period_start, period_end, payment_date, net_cents,
        inss_cents, irrf_cents, gross_cents, irrf_base_cents, dependents,
        inss_table_id, irrf_table_id, code, created_by)
     SELECT *, $15::int FROM unnest(
       $1::int[], $2::smallint[], $3::date[], $4::date[], $5::date[],
       $6::int[], $7::int[], $8::int[], $9::int[], $10::int[], $11::smallint[],
       $12::int[], $13::int[], $14::varchar[])
     RETURNING id, worker_id`,
    [
      column('worker_id'),
      column('number'),
      column('period_start'),
      column('period_end'),
      column('payment_date'),
      column('net_cents'),
      column('inss_cents'),
      column('irrf_cents'),
      column('gross_cents'),
      column('irrf_base_cents'),
      column('dependents'),
      column('inss_table_id'),
      column('irrf_table_id'),
      column('code'),
      createdBy,
    ],
  );
  return rows;
}

async function insertDays(client, lines) {
  if (lines.length === 0) return;

  await client.query(
    `INSERT INTO rpa_payment_days
       (payment_id, worker_id, work_date, part, value_subcents)
     SELECT * FROM unnest($1::int[], $2::int[], $3::date[],
                          $4::rpa_payment_part[], $5::bigint[])`,
    [
      lines.map((line) => line.payment_id),
      lines.map((line) => line.worker_id),
      lines.map((line) => line.date),
      lines.map((line) => line.part),
      lines.map((line) => line.value_subcents),
    ],
  );
}

async function insertAdjustments(client, adjustments) {
  if (adjustments.length === 0) return;

  await client.query(
    `INSERT INTO rpa_payment_adjustments (payment_id, kind, amount_cents, reason)
     SELECT * FROM unnest($1::int[], $2::rpa_adjustment_kind[], $3::int[],
                          $4::varchar[])`,
    [
      adjustments.map((adjustment) => adjustment.payment_id),
      adjustments.map((adjustment) => adjustment.kind),
      adjustments.map((adjustment) => adjustment.amount_cents),
      adjustments.map((adjustment) => adjustment.reason),
    ],
  );
}

// Tudo o que o formulario do RPA imprime, numa consulta: a pessoa inteira, o
// lancamento, a empresa e as tabelas de imposto que o RPA guardou ao ser
// emitido (as impressas sao essas, e nao as vigentes hoje).
const DOCUMENT_SELECT = `
  SELECT p.id, p.number, p.code, p.status, p.period_start, p.period_end,
         p.payment_date, p.net_cents, p.inss_cents, p.irrf_cents,
         p.gross_cents, p.irrf_base_cents, p.dependents, p.issued_at,
         row_to_json(w) AS worker,
         json_build_object(
           'id', l.id, 'city', l.city, 'state', l.state,
           'service_type', l.service_type, 'cost_center', l.cost_center
         ) AS launch,
         json_build_object(
           'code', c.code, 'name', c.name, 'cnpj', c.cnpj,
           'city', c.city, 'state', c.state
         ) AS company,
         row_to_json(ti) AS inss_table,
         row_to_json(tr) AS irrf_table
  FROM rpa_payments p
  JOIN rpa_workers w ON w.id = p.worker_id
  JOIN rpa_launches l ON l.id = w.launch_id
  JOIN rpa_companies c ON c.id = l.company_id
  JOIN rpa_tax_tables ti ON ti.id = p.inss_table_id
  JOIN rpa_tax_tables tr ON tr.id = p.irrf_table_id`;

async function findDocument(id) {
  const { rows } = await db.query(`${DOCUMENT_SELECT} WHERE p.id = $1`, [id]);
  return rows[0] || null;
}

/** Os RPAs validos do n-esimo pagamento do lancamento, pelo numero da pessoa. */
async function findDocumentsByNumber(launchId, number) {
  const { rows } = await db.query(
    `${DOCUMENT_SELECT}
     WHERE w.launch_id = $1 AND p.number = $2 AND p.status <> 'canceled'
     ORDER BY w.number`,
    [launchId, number],
  );
  return rows;
}

/**
 * O resumo do Inicio (issue 43), dos lancamentos abertos e com o "hoje" de
 * Brasilia: o proximo pagamento (data, pessoas, liquido), os RPAs emitidos
 * cuja data passou sem recibo, e quem esta na equipe e ainda nao teve RPA.
 */
async function summary() {
  const { rows } = await db.query(
    `WITH today AS (
       SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS day
     ),
     open_payments AS (
       SELECT p.* FROM rpa_payments p
       JOIN rpa_workers w ON w.id = p.worker_id
       JOIN rpa_launches l ON l.id = w.launch_id
       WHERE l.status = 'open'
     ),
     next_payment AS (
       SELECT payment_date, COUNT(*)::int AS people,
              SUM(net_cents)::int AS net_cents
       FROM open_payments, today
       WHERE status = 'issued' AND payment_date >= today.day
       GROUP BY payment_date
       ORDER BY payment_date
       LIMIT 1
     )
     SELECT
       (SELECT COUNT(*)::int FROM rpa_launches WHERE status = 'open')
         AS open_launches,
       (SELECT row_to_json(next_payment) FROM next_payment) AS next_payment,
       (SELECT COUNT(*)::int FROM open_payments, today
        WHERE status = 'issued' AND payment_date < today.day)
         AS awaiting_receipt,
       (SELECT COUNT(*)::int
        FROM rpa_workers w JOIN rpa_launches l ON l.id = w.launch_id, today
        WHERE l.status = 'open'
          AND COALESCE(w.starts_on, l.starts_on) <= today.day
          AND (w.left_on IS NULL OR w.left_on >= l.starts_on)
          AND NOT EXISTS (
            SELECT 1 FROM rpa_payments p
            WHERE p.worker_id = w.id AND p.status <> 'canceled'
          )) AS without_payment`,
  );
  return rows[0];
}

/** O recibo assinado voltou: o emitido vira pago. O ja pago fica como esta. */
async function markPaid(ids) {
  if (ids.length === 0) return;

  await db.query(
    `UPDATE rpa_payments SET status = 'paid', paid_at = now()
     WHERE id = ANY($1::int[]) AND status = 'issued'`,
    [ids],
  );
}

/** Cancela com motivo; o trigger do banco anula os dias que ele levou. */
async function cancel(id, reason) {
  await db.query(
    `UPDATE rpa_payments
     SET status = 'canceled', canceled_at = now(), cancel_reason = $2
     WHERE id = $1`,
    [id, reason],
  );
  return findById(id);
}

module.exports = {
  findByLaunch,
  count,
  findById,
  ledgerByLaunch,
  numbersByWorkers,
  takenCodes,
  monthTotals,
  taxTables,
  insertMany,
  insertDays,
  insertAdjustments,
  findDocument,
  findDocumentsByNumber,
  markPaid,
  summary,
  cancel,
};
