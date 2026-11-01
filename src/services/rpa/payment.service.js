'use strict';

const db = require('../../config/database');
const Day = require('../../models/rpa-day.model');
const Launch = require('../../models/rpa-launch.model');
const Payment = require('../../models/rpa-payment.model');
const Worker = require('../../models/rpa-worker.model');
const { ConflictError, ValidationError } = require('../../../infra/errors');
const { earliest, latest } = require('./calendar');
const { buildGrid, workerPeriod } = require('./timesheet');
const {
  planWorker,
  nextPaymentNumber,
  paymentCode,
} = require('./payment-plan');
const { NO_PREVIOUS, grossForNet } = require('./taxes');

/**
 * A previa e a emissao dos RPAs de um lancamento (issue 39). As duas passam
 * pela mesma conta (`buildPayments`): a previa so nao grava, e por isso as
 * duas dao o mesmo valor no centavo.
 */

function assertPeriodInLaunch(launch, request) {
  if (
    request.period_start < launch.starts_on ||
    request.period_end > launch.ends_on
  ) {
    throw new ValidationError({
      message: 'O periodo do pagamento sai do lancamento.',
      action: `Escolha um periodo entre ${launch.starts_on} e ${launch.ends_on}.`,
      details: [
        {
          field:
            request.period_start < launch.starts_on
              ? 'period_start'
              : 'period_end',
          message: 'fora do periodo do lancamento',
        },
      ],
    });
  }
}

function assertKnownWorkers(workers, request) {
  const known = new Set(workers.map((worker) => worker.id));
  const selected = new Set(request.worker_ids ?? known);
  const errors = [];

  (request.worker_ids ?? []).forEach((id, index) => {
    if (!known.has(id)) {
      errors.push({
        field: `worker_ids[${index}]`,
        message: 'a pessoa nao e deste lancamento',
      });
    }
  });

  request.adjustments.forEach((adjustment, index) => {
    if (!known.has(adjustment.worker_id)) {
      errors.push({
        field: `adjustments[${index}].worker_id`,
        message: 'a pessoa nao e deste lancamento',
      });
    } else if (!selected.has(adjustment.worker_id)) {
      errors.push({
        field: `adjustments[${index}].worker_id`,
        message: 'a pessoa nao esta entre as escolhidas para o pagamento',
      });
    }
  });

  if (errors.length > 0) throw new ValidationError({ details: errors });

  return selected;
}

/** O livro por pessoa: Map worker_id -> Map data -> { daily, extras, correction }. */
function ledgerOf(rows) {
  const byWorker = new Map();

  for (const row of rows) {
    if (!byWorker.has(row.worker_id)) byWorker.set(row.worker_id, new Map());
    const days = byWorker.get(row.worker_id);
    const day = days.get(row.work_date) ?? { correction: 0 };

    if (row.part === 'correction') day.correction += row.value_subcents;
    else day[row.part] = row.value_subcents;

    days.set(row.work_date, day);
  }

  return byWorker;
}

function isActive(launch, worker, request) {
  const period = workerPeriod(launch, worker);
  return Boolean(
    period &&
    latest(period.first, request.period_start) <=
      earliest(period.last, request.period_end),
  );
}

function skipReason(plan) {
  if (plan.unpriced.length > 0) {
    return `sem diaria vigente em ${plan.unpriced.join(', ')}`;
  }
  if (plan.net_cents < 0) return 'o desconto passa do valor a pagar';
  if (plan.net_cents === 0) return 'nada a pagar';
  return null;
}

/**
 * A conta de cada pessoa escolhida (ou de todas). Quem nao tem o que receber
 * sai em `skipped` com o motivo — so quem esta ativo no periodo ou foi pedido
 * pelo id, para a lista nao trazer a equipe inteira de quem ja saiu.
 */
async function buildPayments(launch, request, client = db) {
  assertPeriodInLaunch(launch, request);

  const [workers, exceptions, ledgerRows, tables] = await Promise.all([
    Worker.findByLaunch(launch.id, client),
    Day.findByLaunch(launch.id, launch.starts_on, launch.ends_on, client),
    Payment.ledgerByLaunch(launch.id, client),
    Payment.taxTables(request.payment_date, client),
  ]);

  if (!tables.inss || !tables.irrf) {
    throw new ValidationError({
      message: `Nao ha tabela de INSS e IRRF vigente em ${request.payment_date}.`,
      action: 'Confira a data do pagamento.',
      details: [{ field: 'payment_date', message: 'sem tabela de imposto' }],
    });
  }

  const selected = assertKnownWorkers(workers, request);
  const chosen = workers.filter((worker) => selected.has(worker.id));
  const [numberRows, monthRows] = await Promise.all([
    Payment.numbersByWorkers(
      chosen.map((worker) => worker.id),
      client,
    ),
    Payment.monthTotals(
      {
        cnpj: launch.company_cnpj,
        cpfs: chosen.map((worker) => worker.cpf),
        paymentDate: request.payment_date,
      },
      client,
    ),
  ]);

  const grid = buildGrid({
    launch,
    workers: chosen,
    exceptions,
    from: launch.starts_on,
    to: launch.ends_on,
  });
  const ledger = ledgerOf(ledgerRows);
  const numbers = new Map(
    numberRows.map((row) => [row.worker_id, row.numbers]),
  );
  const month = new Map(monthRows.map((row) => [row.cpf, row]));
  const period = { from: request.period_start, to: request.period_end };
  const payments = [];
  const skipped = [];

  grid.workers.forEach((row, index) => {
    const worker = chosen[index];
    const taken = numbers.get(worker.id) ?? [];
    const adjustments = request.adjustments
      .filter((adjustment) => adjustment.worker_id === worker.id)
      .map(({ kind, amount_cents, reason }) => ({
        kind,
        amount_cents,
        reason,
      }));
    const plan = planWorker({
      days: new Map(row.days.map((day) => [day.date, day])),
      ledger: ledger.get(worker.id) ?? new Map(),
      period,
      // "1o pagamento so com diarias", por pessoa: quem entrou depois tambem
      // tem o primeiro dela so com diarias.
      dailyOnly: launch.first_payment_daily_only && taken.length === 0,
      adjustments,
    });
    const reason = skipReason(plan);

    if (reason) {
      if (request.worker_ids || isActive(launch, worker, request)) {
        skipped.push({
          worker_id: worker.id,
          worker_number: worker.number,
          worker_name: worker.name,
          reason,
        });
      }
      return;
    }

    const previous = month.get(worker.cpf) ?? NO_PREVIOUS;
    const taxes = grossForNet(plan.net_cents, {
      previous,
      dependents: worker.dependents,
      inssTable: tables.inss,
      irrfTable: tables.irrf,
    });
    const number = nextPaymentNumber(taken);

    payments.push({
      worker_id: worker.id,
      worker_number: worker.number,
      worker_name: worker.name,
      number,
      code: paymentCode({
        number,
        companyCode: launch.company_code,
        workerNumber: worker.number,
        paymentDate: request.payment_date,
      }),
      period_start: request.period_start,
      period_end: request.period_end,
      payment_date: request.payment_date,
      dependents: worker.dependents,
      inss_table_id: tables.inss.id,
      irrf_table_id: tables.irrf.id,
      days: plan.totals,
      deferred_extra_subcents: plan.deferred_extra_subcents,
      lines: plan.lines,
      adjustments,
      value_cents: plan.value_cents,
      adjustments_cents: plan.adjustments_cents,
      month_before: {
        gross_cents: previous.gross_cents,
        inss_cents: previous.inss_cents,
        irrf_cents: previous.irrf_cents,
      },
      ...taxes,
    });
  });

  // Codigo ja usado por outro RPA valido (outro lancamento da mesma empresa
  // no mesmo mes): a pessoa fica de fora com o motivo, em vez de o indice
  // unico do banco derrubar a emissao inteira.
  const taken = new Set(
    payments.length > 0
      ? await Payment.takenCodes(
          payments.map((payment) => payment.code),
          client,
        )
      : [],
  );

  return {
    payments: payments.filter((payment) => !taken.has(payment.code)),
    skipped: [
      ...skipped,
      ...payments
        .filter((payment) => taken.has(payment.code))
        .map((payment) => ({
          worker_id: payment.worker_id,
          worker_number: payment.worker_number,
          worker_name: payment.worker_name,
          reason: `o codigo ${payment.code} ja e de outro RPA valido da empresa`,
        })),
    ],
  };
}

/** POST com `preview=true`: a conta inteira, sem gravar nada. */
function previewPayments(launch, request) {
  return buildPayments(launch, request);
}

/**
 * Emite numa transacao, com o lancamento travado: duas emissoes ao mesmo
 * tempo nao pagam o mesmo dia (o indice unico do banco tambem barraria, mas
 * com 500). O lancamento e relido depois da trava, para a conta usar a
 * diaria e o horario que valem agora.
 */
function issuePayments(launchId, request, createdBy) {
  return db.transaction(async (client) => {
    await Launch.lock(client, launchId);
    const launch = await Launch.findById(launchId, client);

    if (launch.status === 'closed') {
      throw new ConflictError({
        message: `O lancamento ${launchId} esta encerrado.`,
        action: 'Reabra o lancamento para emitir RPA.',
      });
    }

    const result = await buildPayments(launch, request, client);

    if (result.payments.length === 0) {
      throw new ValidationError({
        message: 'Nenhum RPA a emitir no periodo.',
        action: 'Confira a previa: ninguem tem valor a receber.',
        details: result.skipped.map((entry) => ({
          field: 'worker_ids',
          message: `${entry.worker_number}: ${entry.reason}`,
        })),
      });
    }

    const ids = await Payment.insertMany(client, result.payments, createdBy);
    const idOf = new Map(ids.map((row) => [row.worker_id, row.id]));

    await Payment.insertDays(
      client,
      result.payments.flatMap((payment) =>
        payment.lines.map((line) => ({
          ...line,
          payment_id: idOf.get(payment.worker_id),
          worker_id: payment.worker_id,
        })),
      ),
    );
    await Payment.insertAdjustments(
      client,
      result.payments.flatMap((payment) =>
        payment.adjustments.map((adjustment) => ({
          ...adjustment,
          payment_id: idOf.get(payment.worker_id),
        })),
      ),
    );

    return {
      payments: result.payments.map((payment) => ({
        id: idOf.get(payment.worker_id),
        ...payment,
      })),
      skipped: result.skipped,
    };
  });
}

module.exports = { previewPayments, issuePayments };
