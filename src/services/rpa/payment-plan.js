'use strict';

const { SUBCENTS_PER_CENT } = require('./day-value');

/**
 * O que um pagamento leva de uma pessoa (issue 39): uma regra so para todos
 * os pagamentos, no lugar das cinco linhas fixas do RELATORIO, cada uma com a
 * sua formula.
 *
 * - Diaria e extra de cada dia do periodo que ainda nao foram pagos.
 * - Extra pendente de dia anterior, cuja diaria ja foi paga: e o que o 1o
 *   pagamento "so com diarias" deixa para o seguinte.
 * - Correcao de dia ja pago cujo ponto mudou, a mais ou a menos, com o dia.
 * - Acrescimo, bonus e desconto, cada um com motivo. O bonus e pontual e nao
 *   cobre dia nenhum (decisao de 2026-10-31).
 *
 * Tudo em 1/1920 de centavo ate o total da pessoa, arredondado uma vez,
 * meio para longe do zero como o ARRED do Excel.
 */
const ADJUSTMENT_SIGN = { bonus: 1, addition: 1, deduction: -1 };

/** `subcents / 1920` em centavos, meio para longe do zero. */
function roundSubcents(subcents) {
  const cents = Math.floor(
    (Math.abs(subcents) + SUBCENTS_PER_CENT / 2) / SUBCENTS_PER_CENT,
  );
  // Sem o `-0` de uma correcao negativa que arredonda para zero.
  return subcents < 0 && cents > 0 ? -cents : cents;
}

/**
 * `days`: Map data -> dia da grade da pessoa (`daily_subcents`,
 * `extra_subcents`, `value_subcents` nulo sem diaria vigente). `ledger`: Map
 * data -> o que pagamentos validos ja levaram (`daily`, `extras`, soma das
 * `correction`). Dia fora do periodo da pessoa nao esta na grade e vale zero.
 */
function planWorker({ days, ledger, period, dailyOnly, adjustments = [] }) {
  const lines = [];
  const unpriced = new Set();
  let deferred = 0;

  const priced = (date) => {
    const day = days.get(date);
    if (!day) return { daily_subcents: 0, extra_subcents: 0 };
    if (day.value_subcents === null) {
      unpriced.add(date);
      return null;
    }
    return day;
  };

  // O periodo: o que ainda nao foi pago de cada dia.
  for (const [date, day] of days) {
    if (date < period.from || date > period.to) continue;

    const paid = ledger.get(date) ?? {};
    const current = priced(date);
    if (!current) continue;

    if (paid.daily === undefined) {
      lines.push({ date, part: 'daily', value_subcents: day.daily_subcents });
    }

    if (paid.extras === undefined) {
      if (dailyOnly) deferred += day.extra_subcents;
      else {
        lines.push({
          date,
          part: 'extras',
          value_subcents: day.extra_subcents,
        });
      }
    }
  }

  for (const [date, paid] of [...ledger].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (paid.daily === undefined && paid.extras === undefined) continue;

    const current = priced(date);
    if (!current) continue;

    // Extra pendente de dia anterior ao periodo, cuja diaria ja saiu.
    if (
      !dailyOnly &&
      date < period.from &&
      paid.daily !== undefined &&
      paid.extras === undefined
    ) {
      lines.push({
        date,
        part: 'extras',
        value_subcents: current.extra_subcents,
      });
    }

    // Correcao: o que vale hoje para as partes ja pagas, menos o que saiu.
    const expected =
      (paid.daily !== undefined ? current.daily_subcents : 0) +
      (paid.extras !== undefined ? current.extra_subcents : 0);
    const difference =
      expected -
      (paid.daily ?? 0) -
      (paid.extras ?? 0) -
      (paid.correction ?? 0);

    if (difference !== 0) {
      lines.push({ date, part: 'correction', value_subcents: difference });
    }
  }

  const sum = (part) =>
    lines
      .filter((line) => line.part === part)
      .reduce((total, line) => total + line.value_subcents, 0);
  const totals = {
    daily_subcents: sum('daily'),
    extra_subcents: sum('extras'),
    correction_subcents: sum('correction'),
  };
  totals.value_subcents =
    totals.daily_subcents + totals.extra_subcents + totals.correction_subcents;

  const valueCents = roundSubcents(totals.value_subcents);
  const adjustmentsCents = adjustments.reduce(
    (total, adjustment) =>
      total + ADJUSTMENT_SIGN[adjustment.kind] * adjustment.amount_cents,
    0,
  );

  return {
    lines: lines.sort((a, b) =>
      a.date === b.date ? (a.part < b.part ? -1 : 1) : a.date < b.date ? -1 : 1,
    ),
    unpriced: [...unpriced].sort(),
    deferred_extra_subcents: deferred,
    totals,
    value_cents: valueCents,
    adjustments_cents: adjustmentsCents,
    net_cents: valueCents + adjustmentsCents,
  };
}

/** O menor numero livre: cancelar libera o numero para reemitir. */
function nextPaymentNumber(taken) {
  const used = new Set(taken);
  let number = 1;
  while (used.has(number)) number += 1;
  return number;
}

/** `no-empresa-pessoa-mmaaaa`, com o mes e o ano da data do pagamento. */
function paymentCode({ number, companyCode, workerNumber, paymentDate }) {
  const [year, month] = paymentDate.split('-');
  return `${number}-${companyCode}-${workerNumber}-${month}${year}`;
}

module.exports = {
  ADJUSTMENT_SIGN,
  roundSubcents,
  planWorker,
  nextPaymentNumber,
  paymentCode,
};
