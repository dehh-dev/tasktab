'use strict';

/**
 * RPA emitido nunca muda (issue 39). Corrigir e cancelar, com motivo, e
 * emitir de novo: o emitido e o que foi pedido ao financeiro, e reimprimi-lo
 * tem de dar o mesmo papel.
 *
 * A trava fica no banco, e nao no model, pelo mesmo motivo do trigger que
 * anula os dias do cancelado: tem de valer para psql e script tambem.
 *
 * - `rpa_payments`: valores, periodo, pessoa, numero, codigo e tabelas nao
 *   mudam; o que anda e o estado (pago, cancelado) e as datas dele. O
 *   cancelado e final. `created_by` fica livre: apagar o usuario o anula pela
 *   FK. Nenhum RPA e apagado — o cancelado tambem e historico.
 * - `rpa_payment_days`: so `voided` anda, e so de falso para verdadeiro (o
 *   trigger do cancelamento).
 * - `rpa_payment_adjustments`: nada muda nem sai.
 *
 * O erro sai com o nome da trava em `constraint`, como o de uma constraint
 * de verdade: e o que os testes e o `err.constraint` do log usam.
 */

exports.shorthands = undefined;

const IMMUTABLE_PAYMENT_COLUMNS = [
  'worker_id',
  'number',
  'period_start',
  'period_end',
  'payment_date',
  'net_cents',
  'inss_cents',
  'irrf_cents',
  'gross_cents',
  'irrf_base_cents',
  'dependents',
  'inss_table_id',
  'irrf_table_id',
  'code',
  'issued_at',
];

const STATE_COLUMNS = ['status', 'paid_at', 'canceled_at', 'cancel_reason'];

const row = (prefix, columns) =>
  `(${columns.map((column) => `${prefix}.${column}`).join(', ')})`;

function refuse(constraint, message) {
  return `RAISE EXCEPTION USING
        ERRCODE = 'integrity_constraint_violation',
        CONSTRAINT = '${constraint}',
        MESSAGE = ${message};`;
}

const FUNCTIONS = [
  {
    name: 'rpa_payments_lock_issued',
    body: `
    BEGIN
      IF TG_OP = 'DELETE' THEN
        ${refuse('rpa_payments_not_deleted', "format('RPA %s nao se apaga: cancele com motivo', OLD.id)")}
      END IF;

      IF ${row('NEW', IMMUTABLE_PAYMENT_COLUMNS)}
         IS DISTINCT FROM ${row('OLD', IMMUTABLE_PAYMENT_COLUMNS)} THEN
        ${refuse('rpa_payments_issued_immutable', "format('RPA %s emitido nao muda: cancele e emita de novo', OLD.id)")}
      END IF;

      IF OLD.status = 'canceled'
         AND ${row('NEW', STATE_COLUMNS)} IS DISTINCT FROM ${row('OLD', STATE_COLUMNS)} THEN
        ${refuse('rpa_payments_canceled_final', "format('RPA %s esta cancelado', OLD.id)")}
      END IF;

      RETURN NEW;
    END;`,
  },
  {
    name: 'rpa_payment_days_lock',
    body: `
    BEGIN
      IF TG_OP = 'DELETE' THEN
        ${refuse('rpa_payment_days_immutable', "'o que um RPA levou de cada dia nao sai'")}
      END IF;

      IF (NEW.payment_id, NEW.worker_id, NEW.work_date, NEW.part, NEW.value_subcents)
         IS DISTINCT FROM
         (OLD.payment_id, OLD.worker_id, OLD.work_date, OLD.part, OLD.value_subcents)
         OR (OLD.voided AND NOT NEW.voided) THEN
        ${refuse('rpa_payment_days_immutable', "'o que um RPA levou de cada dia nao muda'")}
      END IF;

      RETURN NEW;
    END;`,
  },
  {
    name: 'rpa_payment_adjustments_lock',
    body: `
    BEGIN
      ${refuse('rpa_payment_adjustments_immutable', "'acrescimo e desconto de RPA emitido nao mudam'")}
    END;`,
  },
];

const TRIGGERS = [
  ['rpa_payments', 'rpa_payments_lock_issued', 'rpa_payments_lock_issued'],
  ['rpa_payment_days', 'rpa_payment_days_lock', 'rpa_payment_days_lock'],
  [
    'rpa_payment_adjustments',
    'rpa_payment_adjustments_lock',
    'rpa_payment_adjustments_lock',
  ],
];

exports.up = (pgm) => {
  for (const { name, body } of FUNCTIONS) {
    pgm.createFunction(
      name,
      [],
      { returns: 'trigger', language: 'plpgsql', replace: true },
      body,
    );
  }

  for (const [table, trigger, fn] of TRIGGERS) {
    pgm.createTrigger(table, trigger, {
      when: 'BEFORE',
      operation: ['UPDATE', 'DELETE'],
      level: 'ROW',
      function: fn,
    });
  }
};

exports.down = (pgm) => {
  for (const [table, trigger] of TRIGGERS) {
    pgm.dropTrigger(table, trigger);
  }

  for (const { name } of FUNCTIONS) {
    pgm.dropFunction(name, []);
  }
};
