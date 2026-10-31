'use strict';

const { isoWeekday, eachDate, latest, earliest } = require('./calendar');
const {
  SUBCENTS_PER_CENT,
  FULL_DAY_MINUTES,
  formatMinutes,
  workedMinutes,
  crossesMidnight,
  dayKind,
  dailyCentsFor,
  dayValue,
} = require('./day-value');

/**
 * A grade do ponto (issue 38): pessoa x dia, preenchida com o horario padrao
 * do lancamento, em que so a excecao vem do banco (`rpa_days`). Substitui a
 * LANCA e o Botao 1 da planilha, que geravam uma linha digitada por pessoa por
 * dia — e geravam de novo para quem ja tinha saido.
 */
const TIME_FIELDS = ['start_time', 'lunch_out', 'lunch_in', 'end_time'];
const OFF = {
  quantity: 0,
  start_time: null,
  lunch_out: null,
  lunch_in: null,
  end_time: null,
};

function plannedDay(schedule, date) {
  const weekday = isoWeekday(date);
  const day = schedule.find((entry) => entry.weekday === weekday);
  return day ? { ...day, quantity: Number(day.quantity) } : null;
}

/**
 * Do inicio da pessoa a saida dela, os dois inclusive, dentro do lancamento.
 * Sem inicio informado, vale o do lancamento. `null` quando nao sobra dia.
 */
function workerPeriod(launch, worker) {
  const first = latest(launch.starts_on, worker.starts_on);
  const last = earliest(launch.ends_on, worker.left_on);
  return first <= last ? { first, last } : null;
}

/**
 * A excecao que nao muda nada nao e excecao: com a mesma quantidade, os
 * mesmos horarios e sem observacao, o dia volta ao padrao em vez de virar
 * linha em `rpa_days`.
 */
function sameAsPlanned(entry, launch, date) {
  const planned = plannedDay(launch.schedule, date) ?? OFF;

  return (
    !entry.note &&
    entry.quantity === planned.quantity &&
    TIME_FIELDS.every((field) => (entry[field] ?? null) === planned[field])
  );
}

function noRateMessage(worker, date) {
  return worker.role
    ? `sem diaria vigente para "${worker.role}" em ${date}`
    : 'pessoa sem funcao: nao ha diaria para calcular';
}

function buildDay({ date, launch, worker, exception }) {
  const planned = plannedDay(launch.schedule, date);
  const entry = exception ?? planned ?? OFF;
  const kind = dayKind(date, launch.holidays);
  const worked = entry.quantity > 0 ? workedMinutes(entry) : 0;
  const dailyCents =
    entry.quantity > 0 ? dailyCentsFor(launch.rates, worker, date) : null;
  const value = dayValue({
    kind,
    quantity: entry.quantity,
    workedMinutes: worked,
    dailyCents: dailyCents ?? 0,
  });
  const priced = entry.quantity === 0 || dailyCents !== null;
  const flags = [];

  if (!priced) {
    flags.push({ code: 'no_rate', message: noRateMessage(worker, date) });
  }

  if (value.short_minutes > 0) {
    const base = FULL_DAY_MINUTES * entry.quantity;
    flags.push({
      code: 'short_day',
      message: `${formatMinutes(worked)} de ${formatMinutes(base)}: nao desconta sozinho`,
    });
  }

  if (entry.quantity > 0 && crossesMidnight(entry)) {
    flags.push({ code: 'overnight', message: 'a saida passa da meia-noite' });
  }

  return {
    date,
    weekday: isoWeekday(date),
    kind,
    source: exception ? 'exception' : planned ? 'schedule' : 'off',
    quantity: entry.quantity,
    start_time: entry.start_time ?? null,
    lunch_out: entry.lunch_out ?? null,
    lunch_in: entry.lunch_in ?? null,
    end_time: entry.end_time ?? null,
    note: exception?.note ?? null,
    worked_minutes: worked,
    extra_minutes: value.extra_minutes,
    daily_cents: dailyCents,
    daily_subcents: priced ? value.daily_subcents : null,
    extra_subcents: priced ? value.extra_subcents : null,
    value_subcents: priced ? value.daily_subcents + value.extra_subcents : null,
    flags,
  };
}

function totalsOf(days) {
  const totals = {
    quantity: 0,
    daily_subcents: 0,
    extra_subcents: 0,
    value_subcents: 0,
    days_without_rate: 0,
  };

  for (const day of days) {
    totals.quantity += day.quantity;

    if (day.value_subcents === null) {
      totals.days_without_rate += 1;
      continue;
    }

    totals.daily_subcents += day.daily_subcents;
    totals.extra_subcents += day.extra_subcents;
    totals.value_subcents += day.value_subcents;
  }

  return totals;
}

/**
 * A grade de `from` a `to` (ja dentro do lancamento). `exceptions` sao as
 * linhas de `rpa_days` do recorte; `workers`, a equipe pelo numero.
 */
function buildGrid({ launch, workers, exceptions, from, to }) {
  const byKey = new Map(
    exceptions.map((row) => [`${row.worker_id}|${row.work_date}`, row]),
  );

  return {
    from,
    to,
    holidays: launch.holidays.filter((date) => from <= date && date <= to),
    subcents_per_cent: SUBCENTS_PER_CENT,
    workers: workers.map((worker) => {
      const period = workerPeriod(launch, worker);
      const first = period && latest(from, period.first);
      const last = period && earliest(to, period.last);
      const days =
        period && first <= last
          ? eachDate(first, last).map((date) =>
              buildDay({
                date,
                launch,
                worker,
                exception: byKey.get(`${worker.id}|${date}`) ?? null,
              }),
            )
          : [];

      return {
        id: worker.id,
        number: worker.number,
        name: worker.name,
        role: worker.role,
        starts_on: worker.starts_on,
        left_on: worker.left_on,
        promoted_since: worker.promoted_since,
        totals: totalsOf(days),
        days,
      };
    }),
  };
}

module.exports = { workerPeriod, sameAsPlanned, noRateMessage, buildGrid };
