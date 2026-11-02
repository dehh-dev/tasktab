'use strict';

const db = require('../config/database');

// Retencao (decisao de 2026-11-01): um mes depois de encerrado, os dados
// pessoais da equipe e os arquivos saem. `purge_on` e o dia em Brasilia a
// partir do qual a varredura os apaga; `purged_on`, o dia em que apagou.
const RETENTION = "interval '1 month'";

// O horario padrao e as diarias vem junto, como arrays: sao parte da
// definicao do lancamento, e a tela os edita com ele.
const SELECT = `
  SELECT l.id, l.company_id, c.code AS company_code, c.name AS company_name,
         c.cnpj AS company_cnpj,
         l.city, l.state, l.development, l.starts_on, l.ends_on, l.holidays,
         l.service_type, l.cost_center, l.site, l.product, l.supply,
         l.email_to, l.email_cc, l.first_payment_daily_only, l.status,
         l.closed_at, l.purged_at,
         ((l.closed_at AT TIME ZONE 'America/Sao_Paulo') + ${RETENTION})::date
           AS purge_on,
         (l.purged_at AT TIME ZONE 'America/Sao_Paulo')::date AS purged_on,
         l.created_by, l.created_at, l.updated_at,
         COALESCE((
           SELECT json_agg(json_build_object(
                    'weekday', s.weekday,
                    'quantity', s.quantity,
                    'start_time', to_char(s.start_time, 'HH24:MI'),
                    'lunch_out', to_char(s.lunch_out, 'HH24:MI'),
                    'lunch_in', to_char(s.lunch_in, 'HH24:MI'),
                    'end_time', to_char(s.end_time, 'HH24:MI'))
                  ORDER BY s.weekday)
           FROM rpa_launch_schedules s WHERE s.launch_id = l.id
         ), '[]') AS schedule,
         COALESCE((
           SELECT json_agg(json_build_object(
                    'id', r.id,
                    'role', r.role,
                    'starts_on', r.starts_on,
                    'ends_on', r.ends_on,
                    'daily_cents', r.daily_cents,
                    'promoted_bonus_cents', r.promoted_bonus_cents)
                  ORDER BY r.role, r.starts_on)
           FROM rpa_rates r WHERE r.launch_id = l.id
         ), '[]') AS rates
  FROM rpa_launches l
  JOIN rpa_companies c ON c.id = l.company_id`;

// `company_id` fica de fora: trocar a empresa mudaria o codigo e o
// cabecalho de RPA ja pensado para ela. Lancamento errado se apaga e se cria
// de novo, enquanto nao ha RPA.
const UPDATABLE_COLUMNS = [
  'city',
  'state',
  'development',
  'starts_on',
  'ends_on',
  'holidays',
  'service_type',
  'cost_center',
  'site',
  'product',
  'supply',
  'email_to',
  'email_cc',
  'first_payment_daily_only',
  'status',
];

const CASTS = {
  holidays: '::date[]',
  email_to: '::text[]',
  email_cc: '::text[]',
};

async function findAll({ limit = 50, offset = 0, status } = {}) {
  const params = [limit, offset];
  let where = '';

  if (status) {
    params.push(status);
    where = 'WHERE l.status = $3';
  }

  const { rows } = await db.query(
    `${SELECT} ${where} ORDER BY l.starts_on DESC, l.id DESC LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

async function count({ status } = {}) {
  const { rows } = await db.query(
    status
      ? 'SELECT COUNT(*)::int AS total FROM rpa_launches WHERE status = $1'
      : 'SELECT COUNT(*)::int AS total FROM rpa_launches',
    status ? [status] : [],
  );
  return rows[0].total;
}

async function findById(id, client = db) {
  const { rows } = await client.query(`${SELECT} WHERE l.id = $1`, [id]);
  return rows[0] || null;
}

async function replaceSchedule(client, launchId, schedule) {
  await client.query('DELETE FROM rpa_launch_schedules WHERE launch_id = $1', [
    launchId,
  ]);

  for (const day of schedule) {
    await client.query(
      `INSERT INTO rpa_launch_schedules
         (launch_id, weekday, quantity, start_time, lunch_out, lunch_in, end_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        launchId,
        day.weekday,
        day.quantity,
        day.start_time,
        day.lunch_out,
        day.lunch_in,
        day.end_time,
      ],
    );
  }
}

async function replaceRates(client, launchId, rates) {
  await client.query('DELETE FROM rpa_rates WHERE launch_id = $1', [launchId]);

  for (const rate of rates) {
    await client.query(
      `INSERT INTO rpa_rates
         (launch_id, role, starts_on, ends_on, daily_cents, promoted_bonus_cents)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        launchId,
        rate.role,
        rate.starts_on,
        rate.ends_on,
        rate.daily_cents,
        rate.promoted_bonus_cents,
      ],
    );
  }
}

/** Cria o lancamento com horario e diarias, numa transacao so. */
function create(data, createdBy) {
  return db.transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO rpa_launches
         (company_id, city, state, development, starts_on, ends_on, holidays,
          service_type, cost_center, site, product, supply, email_to, email_cc,
          first_payment_daily_only, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::date[], $8, $9, $10, $11, $12,
               $13::text[], $14::text[], COALESCE($15, true), $16)
       RETURNING id`,
      [
        data.company_id,
        data.city,
        data.state,
        data.development,
        data.starts_on,
        data.ends_on,
        data.holidays ?? [],
        data.service_type ?? null,
        data.cost_center ?? null,
        data.site ?? null,
        data.product ?? null,
        data.supply ?? null,
        data.email_to ?? [],
        data.email_cc ?? [],
        data.first_payment_daily_only ?? null,
        createdBy,
      ],
    );
    const { id } = rows[0];

    await replaceSchedule(client, id, data.schedule ?? []);
    await replaceRates(client, id, data.rates ?? []);

    return findById(id, client);
  });
}

/**
 * Atualiza o que veio. `schedule` e `rates`, quando vem, substituem a lista
 * inteira: a tela manda o horario e a tabela de diarias como estao.
 */
function update(id, data) {
  return db.transaction(async (client) => {
    const assignments = [];
    const params = [];

    for (const column of UPDATABLE_COLUMNS) {
      if (Object.prototype.hasOwnProperty.call(data, column)) {
        params.push(data[column]);
        assignments.push(`${column} = $${params.length}${CASTS[column] || ''}`);
      }
    }

    if (assignments.length > 0) {
      // `updated_at` fica por conta do trigger rpa_launches_set_updated_at.
      params.push(id);
      await client.query(
        `UPDATE rpa_launches SET ${assignments.join(', ')}
         WHERE id = $${params.length}`,
        params,
      );
    }

    if (data.schedule !== undefined) {
      await replaceSchedule(client, id, data.schedule);
    }

    if (data.rates !== undefined) {
      await replaceRates(client, id, data.rates);
    }

    return findById(id, client);
  });
}

/**
 * Quantos RPAs o lancamento tem, cancelados inclusive: com qualquer um, nao
 * se apaga. E a mesma regra do RESTRICT de `rpa_payments.worker_id` — o
 * cancelado tambem e historico do que foi pedido ao financeiro.
 */
async function countPayments(id) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM rpa_payments p JOIN rpa_workers w ON w.id = p.worker_id
     WHERE w.launch_id = $1`,
    [id],
  );
  return rows[0].total;
}

/** Devolve a linha, para quem chama saber que ela existia. */
async function remove(id) {
  const { rows } = await db.query(
    'DELETE FROM rpa_launches WHERE id = $1 RETURNING id',
    [id],
  );
  return rows[0] || null;
}

/** Os lancamentos encerrados ha mais de um mes que ainda tem os dados. */
async function findExpired() {
  const { rows } = await db.query(
    `SELECT id FROM rpa_launches
     WHERE status = 'closed' AND purged_at IS NULL
       AND closed_at <= now() - ${RETENTION}
     ORDER BY id`,
  );
  return rows.map((row) => row.id);
}

/**
 * Trava o lancamento vencido e confere de novo, dentro da transacao: quem o
 * reabriu entre a busca e a trava fica com os dados. `null` se nao vale mais.
 */
async function lockExpired(client, id) {
  const { rows } = await client.query(
    `SELECT id FROM rpa_launches
     WHERE id = $1 AND status = 'closed' AND purged_at IS NULL
       AND closed_at <= now() - ${RETENTION}
     FOR UPDATE`,
    [id],
  );
  return rows[0] || null;
}

async function markPurged(client, id) {
  await client.query(
    'UPDATE rpa_launches SET purged_at = now() WHERE id = $1',
    [id],
  );
}

/** Trava o lancamento ate o fim da transacao: duas importacoes nao se cruzam. */
async function lock(client, id) {
  await client.query('SELECT id FROM rpa_launches WHERE id = $1 FOR UPDATE', [
    id,
  ]);
}

module.exports = {
  UPDATABLE_COLUMNS,
  findAll,
  count,
  findById,
  create,
  update,
  countPayments,
  remove,
  lock,
  findExpired,
  lockExpired,
  markPurged,
};
