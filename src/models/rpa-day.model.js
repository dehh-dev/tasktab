'use strict';

const db = require('../config/database');

/**
 * As excecoes ao horario padrao (issue 38). A grade inteira nasce do horario
 * do lancamento; aqui fica so o dia que mudou, e o valor nunca e gravado — e
 * calculado na leitura, entao mudar a diaria ou o feriado ja vale para a
 * grade.
 *
 * Gravar e apagar sao uma consulta cada, qualquer que seja o tamanho do lote
 * (`unnest` dos arrays): a grade da equipe inteira sai num PUT so.
 */
async function findByLaunch(launchId, from, to, client = db) {
  const { rows } = await client.query(
    `SELECT d.worker_id, d.work_date, d.quantity::float8 AS quantity,
            to_char(d.start_time, 'HH24:MI') AS start_time,
            to_char(d.lunch_out, 'HH24:MI') AS lunch_out,
            to_char(d.lunch_in, 'HH24:MI') AS lunch_in,
            to_char(d.end_time, 'HH24:MI') AS end_time,
            d.note
     FROM rpa_days d JOIN rpa_workers w ON w.id = d.worker_id
     WHERE w.launch_id = $1 AND d.work_date BETWEEN $2 AND $3`,
    [launchId, from, to],
  );
  return rows;
}

/**
 * Grava ou substitui as excecoes. A linha que ja estava igual nao e
 * reescrita, para o `updated_at` dizer quando o dia mudou de verdade.
 */
async function upsert(client, days) {
  if (days.length === 0) return;

  await client.query(
    `INSERT INTO rpa_days
       (worker_id, work_date, quantity, start_time, lunch_out, lunch_in,
        end_time, note)
     SELECT * FROM unnest($1::int[], $2::date[], $3::numeric[], $4::time[],
                          $5::time[], $6::time[], $7::time[], $8::varchar[])
     ON CONFLICT (worker_id, work_date) DO UPDATE SET
       quantity = EXCLUDED.quantity,
       start_time = EXCLUDED.start_time,
       lunch_out = EXCLUDED.lunch_out,
       lunch_in = EXCLUDED.lunch_in,
       end_time = EXCLUDED.end_time,
       note = EXCLUDED.note
     WHERE (rpa_days.quantity, rpa_days.start_time, rpa_days.lunch_out,
            rpa_days.lunch_in, rpa_days.end_time, rpa_days.note)
       IS DISTINCT FROM
           (EXCLUDED.quantity, EXCLUDED.start_time, EXCLUDED.lunch_out,
            EXCLUDED.lunch_in, EXCLUDED.end_time, EXCLUDED.note)`,
    [
      days.map((day) => day.worker_id),
      days.map((day) => day.date),
      days.map((day) => day.quantity),
      days.map((day) => day.start_time),
      days.map((day) => day.lunch_out),
      days.map((day) => day.lunch_in),
      days.map((day) => day.end_time),
      days.map((day) => day.note),
    ],
  );
}

/** Tira as excecoes: o dia volta ao horario padrao. */
async function remove(client, days) {
  if (days.length === 0) return;

  await client.query(
    `DELETE FROM rpa_days d
     USING unnest($1::int[], $2::date[]) AS k(worker_id, work_date)
     WHERE d.worker_id = k.worker_id AND d.work_date = k.work_date`,
    [days.map((day) => day.worker_id), days.map((day) => day.date)],
  );
}

module.exports = { findByLaunch, upsert, remove };
