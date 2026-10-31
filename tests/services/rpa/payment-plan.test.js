'use strict';

const {
  roundSubcents,
  planWorker,
  nextPaymentNumber,
  paymentCode,
} = require('../../../src/services/rpa/payment-plan');
const { SUBCENTS_PER_CENT } = require('../../../src/services/rpa/day-value');

const subcents = (reais) => Math.round(reais * 100 * SUBCENTS_PER_CENT);

/** Um dia da grade com diaria e extra em reais. */
const priced = (daily, extra) => ({
  daily_subcents: subcents(daily),
  extra_subcents: subcents(extra),
  value_subcents: subcents(daily + extra),
});

// Diaria de R$ 130,00: dia util de 9h = 130 + 24,375 de extra.
const NINE_HOURS = priced(130, 24.375);

const FIRST_WEEK = [
  '2026-10-13',
  '2026-10-14',
  '2026-10-15',
  '2026-10-16',
  '2026-10-19',
];

function grid(entries) {
  return new Map(entries);
}

/** O que o 1o pagamento, so com diarias, deixou no livro. */
function paidDailyOnly(dates) {
  return new Map(
    dates.map((date) => [date, { daily: subcents(130), correction: 0 }]),
  );
}

describe('planWorker: os criterios da issue 39', () => {
  it('1o pagamento so com diarias: R$ 650,00, e os R$ 121,875 de extra ficam pendentes', () => {
    const plan = planWorker({
      days: grid(FIRST_WEEK.map((date) => [date, NINE_HOURS])),
      ledger: new Map(),
      period: { from: '2026-10-13', to: '2026-10-19' },
      dailyOnly: true,
    });

    expect(plan.value_cents).toBe(65000);
    expect(plan.deferred_extra_subcents).toBe(subcents(121.875));
    expect(plan.lines.map((line) => line.part)).toEqual(
      FIRST_WEEK.map(() => 'daily'),
    );
  });

  it('o seguinte, com um dia de 8h, um sabado de 9h45 e os extras pendentes: R$ 424,53125 -> R$ 424,53', () => {
    const plan = planWorker({
      days: grid([
        ...FIRST_WEEK.map((date) => [date, NINE_HOURS]),
        ['2026-10-20', priced(130, 0)],
        ['2026-10-24', priced(130, 42.65625)],
      ]),
      ledger: paidDailyOnly(FIRST_WEEK),
      period: { from: '2026-10-20', to: '2026-10-24' },
      dailyOnly: false,
    });

    expect(plan.totals.value_subcents).toBe(subcents(424.53125));
    expect(plan.value_cents).toBe(42453);
    expect(
      plan.lines
        .filter((line) => line.date < '2026-10-20')
        .map((line) => line.part),
    ).toEqual(FIRST_WEEK.map(() => 'extras'));
  });

  it('pagar de novo um periodo ja pago so traz o que ficou pendente', () => {
    const plan = planWorker({
      days: grid(FIRST_WEEK.map((date) => [date, NINE_HOURS])),
      ledger: paidDailyOnly(FIRST_WEEK),
      period: { from: '2026-10-13', to: '2026-10-19' },
      dailyOnly: false,
    });

    expect(plan.totals).toEqual({
      daily_subcents: 0,
      extra_subcents: subcents(121.875),
      correction_subcents: 0,
      value_subcents: subcents(121.875),
    });
  });

  it('desconto subtrai, e bonus e acrescimo somam, em qualquer pagamento', () => {
    const plan = planWorker({
      days: grid([['2026-10-20', priced(130, 0)]]),
      ledger: new Map(),
      period: { from: '2026-10-20', to: '2026-10-20' },
      dailyOnly: false,
      adjustments: [
        { kind: 'deduction', amount_cents: 2000, reason: 'adiantamento' },
        { kind: 'bonus', amount_cents: 5000, reason: 'meta da semana' },
        { kind: 'addition', amount_cents: 1500, reason: 'alimentacao' },
      ],
    });

    expect(plan.value_cents).toBe(13000);
    expect(plan.adjustments_cents).toBe(4500);
    expect(plan.net_cents).toBe(17500);
  });
});

describe('planWorker: dia ja pago cujo ponto mudou', () => {
  const PAID_FULL = {
    daily: subcents(130),
    extras: subcents(24.375),
    correction: 0,
  };

  it('a diferenca a menos entra como correcao, com o dia', () => {
    const plan = planWorker({
      days: grid([
        ['2026-10-14', priced(0, 0)],
        ['2026-10-20', priced(130, 0)],
      ]),
      ledger: new Map([['2026-10-14', PAID_FULL]]),
      period: { from: '2026-10-20', to: '2026-10-20' },
      dailyOnly: false,
    });

    expect(plan.lines).toContainEqual({
      date: '2026-10-14',
      part: 'correction',
      value_subcents: -subcents(154.375),
    });
    expect(plan.value_cents).toBe(13000 - 15438);
  });

  it('a diferenca a mais tambem, e a correcao ja paga nao se repete', () => {
    const days = grid([['2026-10-14', priced(130, 48.75)]]);
    const period = { from: '2026-10-20', to: '2026-10-20' };

    const first = planWorker({
      days,
      ledger: new Map([['2026-10-14', PAID_FULL]]),
      period,
      dailyOnly: false,
    });
    const again = planWorker({
      days,
      ledger: new Map([
        ['2026-10-14', { ...PAID_FULL, correction: subcents(24.375) }],
      ]),
      period,
      dailyOnly: false,
    });

    expect(first.totals.correction_subcents).toBe(subcents(24.375));
    expect(again.lines).toEqual([]);
  });

  it('dia pago que saiu do periodo da pessoa volta inteiro como correcao', () => {
    const plan = planWorker({
      days: new Map(),
      ledger: new Map([['2026-10-30', PAID_FULL]]),
      period: { from: '2026-10-20', to: '2026-10-24' },
      dailyOnly: false,
    });

    expect(plan.totals.correction_subcents).toBe(-subcents(154.375));
  });
});

describe('planWorker: dia sem diaria vigente', () => {
  it('fica de fora do total e e apontado', () => {
    const plan = planWorker({
      days: grid([
        [
          '2026-11-16',
          { daily_subcents: 0, extra_subcents: 0, value_subcents: null },
        ],
        ['2026-11-13', priced(130, 0)],
      ]),
      ledger: new Map(),
      period: { from: '2026-11-13', to: '2026-11-16' },
      dailyOnly: false,
    });

    expect(plan.unpriced).toEqual(['2026-11-16']);
  });
});

describe('roundSubcents', () => {
  it.each([
    [subcents(424.53125), 42453],
    [subcents(154.375), 15438],
    [subcents(0.005), 1],
    [-subcents(154.375), -15438],
    [-subcents(0.004), 0],
  ])('%i subcentavos -> %i centavos', (value, cents) => {
    expect(roundSubcents(value)).toBe(cents);
  });
});

describe('numero e codigo do RPA', () => {
  it('o numero e o menor livre: cancelar libera o numero', () => {
    expect(nextPaymentNumber([])).toBe(1);
    expect(nextPaymentNumber([1, 2])).toBe(3);
    expect(nextPaymentNumber([2, 3])).toBe(1);
  });

  it('o codigo e no-empresa-pessoa-mmaaaa', () => {
    expect(
      paymentCode({
        number: 2,
        companyCode: 815,
        workerNumber: 7,
        paymentDate: '2026-10-28',
      }),
    ).toBe('2-815-7-102026');
  });
});
