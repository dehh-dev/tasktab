'use strict';

const {
  SUBCENTS_PER_CENT,
  formatMinutes,
  checkTimes,
  workedMinutes,
  crossesMidnight,
  dayKind,
  dailyCentsFor,
  dayValue,
} = require('../../../src/services/rpa/day-value');

// A diaria dos criterios da issue 38 e da planilha de Avare: R$ 130,00.
const DAILY = 13000;

/** R$ em 1/1920 de centavo, a unidade do calculo. */
const subcents = (reais) => Math.round(reais * 100 * SUBCENTS_PER_CENT);

function valueOf(kind, quantity, times) {
  const value = dayValue({
    kind,
    quantity,
    workedMinutes: workedMinutes(times),
    dailyCents: DAILY,
  });
  return { ...value, total: value.daily_subcents + value.extra_subcents };
}

const day = (start, lunchOut, lunchIn, end) => ({
  start_time: start,
  lunch_out: lunchOut,
  lunch_in: lunchIn,
  end_time: end,
});

describe('dayValue: os criterios da issue 38, com diaria de R$ 130,00', () => {
  it.each([
    [
      'dia util 8h-18h com 1h de almoco',
      'weekday',
      1,
      day('08:00', '12:00', '13:00', '18:00'),
      154.375,
    ],
    [
      'dia util 5h45-20h com 20 min de almoco (13h55)',
      'weekday',
      1,
      day('05:45', '12:00', '12:20', '20:00'),
      274.21875,
    ],
    [
      'sabado com 9h45',
      'saturday',
      1,
      day('07:00', '12:00', '13:00', '17:45'),
      172.65625,
    ],
    [
      'domingo com 9h45',
      'sunday',
      1,
      day('07:00', '12:00', '13:00', '17:45'),
      316.875,
    ],
    [
      'feriado com 9h',
      'holiday',
      1,
      day('08:00', '12:00', '13:00', '18:00'),
      292.5,
    ],
    [
      'meio periodo de 4h',
      'weekday',
      0.5,
      day('08:00', null, null, '12:00'),
      65,
    ],
  ])('%s', (_, kind, quantity, times, reais) => {
    expect(valueOf(kind, quantity, times).total).toBe(subcents(reais));
  });
});

describe('dayValue: as regras decididas para o que a planilha fazia diferente', () => {
  it('domingo com menos de 8h continua com as duas diarias', () => {
    const value = valueOf('sunday', 1, day('08:00', null, null, '12:00'));

    expect(value.total).toBe(subcents(260));
    expect(value.short_minutes).toBe(240);
  });

  it('feriado com menos de 8h tambem', () => {
    expect(valueOf('holiday', 1, day('08:00', null, null, '13:00')).total).toBe(
      subcents(260),
    );
  });

  it('sabado com menos de 8h nao desconta e fica marcado', () => {
    const value = valueOf('saturday', 1, day('08:00', null, null, '14:00'));

    expect(value.total).toBe(subcents(130));
    expect(value.short_minutes).toBe(120);
  });

  it('dia util com menos de 8h nao desconta e fica marcado', () => {
    const value = valueOf(
      'weekday',
      1,
      day('08:00', '12:00', '13:00', '16:00'),
    );

    expect(value.total).toBe(subcents(130));
    expect(value.short_minutes).toBe(60);
  });

  it('a diaria e o extra saem separados', () => {
    const value = valueOf(
      'weekday',
      1,
      day('08:00', '12:00', '13:00', '18:00'),
    );

    expect(value.daily_subcents).toBe(subcents(130));
    expect(value.extra_subcents).toBe(subcents(24.375));
    expect(value.extra_minutes).toBe(60);
  });

  it('falta nao vale nada', () => {
    expect(
      dayValue({
        kind: 'sunday',
        quantity: 0,
        workedMinutes: 0,
        dailyCents: DAILY,
      }),
    ).toEqual({
      daily_subcents: 0,
      extra_subcents: 0,
      extra_minutes: 0,
      short_minutes: 0,
    });
  });

  it('meia diaria no domingo e dobrada: vale uma diaria', () => {
    expect(
      valueOf('sunday', 0.5, day('08:00', null, null, '12:00')).total,
    ).toBe(subcents(130));
  });

  it('meia diaria acima de 4h paga o extra com a mesma hora normal', () => {
    // 65 + 1h a 50% de 16,25 = 65 + 24,375.
    expect(
      valueOf('weekday', 0.5, day('08:00', null, null, '13:00')).total,
    ).toBe(subcents(89.375));
  });

  it('diaria de centavo impar: a meia diaria fecha em subcentavo, sem perder nada', () => {
    const value = dayValue({
      kind: 'weekday',
      quantity: 0.5,
      workedMinutes: 240,
      dailyCents: 13001,
    });

    expect(value.daily_subcents).toBe(6500.5 * SUBCENTS_PER_CENT);
    expect(Number.isInteger(value.daily_subcents)).toBe(true);
  });

  it('o extra por minuto e inteiro em subcentavo a 50% e a 100%', () => {
    for (const kind of ['weekday', 'sunday']) {
      const value = dayValue({
        kind,
        quantity: 1,
        workedMinutes: 481,
        dailyCents: 13001,
      });
      expect(Number.isInteger(value.extra_subcents)).toBe(true);
    }
  });
});

describe('workedMinutes e crossesMidnight', () => {
  it('desconta o almoco', () => {
    expect(workedMinutes(day('08:00', '12:00', '13:00', '18:00'))).toBe(540);
  });

  it('sem almoco, e da entrada a saida', () => {
    expect(workedMinutes(day('08:00', null, null, '12:00'))).toBe(240);
  });

  it('turno da noite passa da meia-noite', () => {
    const night = day('22:00', '02:00', '03:00', '07:00');

    expect(workedMinutes(night)).toBe(480);
    expect(crossesMidnight(night)).toBe(true);
    expect(crossesMidnight(day('08:00', '12:00', '13:00', '18:00'))).toBe(
      false,
    );
  });
});

describe('checkTimes', () => {
  it.each([
    ['dia comum', day('08:00', '12:00', '13:00', '18:00')],
    ['sem almoco', day('08:00', null, null, '12:00')],
    ['turno da noite', day('22:00', '02:00', '03:00', '07:00')],
    [
      'saida depois da meia-noite, sem almoco',
      day('18:00', null, null, '01:30'),
    ],
  ])('aceita %s', (_, times) => {
    expect(checkTimes(times)).toBeNull();
  });

  it.each([
    ['entrada igual a saida', day('08:00', null, null, '08:00'), /iguais/],
    [
      'saida do almoco igual a entrada',
      day('08:00', '08:00', '09:00', '17:00'),
      /iguais/,
    ],
    ['duas viradas de dia', day('08:00', '07:00', '06:00', '05:00'), /24h/],
    [
      'almoco antes da entrada, que vira 24h',
      day('08:00', '12:00', '07:00', '09:00'),
      /24h/,
    ],
  ])('recusa %s', (_, times, message) => {
    expect(checkTimes(times)).toMatch(message);
  });
});

describe('dayKind', () => {
  it.each([
    ['2026-10-13', [], 'weekday'],
    ['2026-10-17', [], 'saturday'],
    ['2026-10-18', [], 'sunday'],
    ['2026-11-02', ['2026-11-02'], 'holiday'],
    // Feriado no domingo e feriado: as duas regras sao a mesma, e nao somam.
    ['2026-11-15', ['2026-11-15'], 'holiday'],
  ])('%s com feriados %j e %s', (date, holidays, kind) => {
    expect(dayKind(date, holidays)).toBe(kind);
  });
});

describe('dailyCentsFor', () => {
  const RATES = [
    {
      role: 'Assistente Administrativo',
      starts_on: '2026-10-13',
      ends_on: '2026-10-31',
      daily_cents: 13000,
      promoted_bonus_cents: 1000,
    },
    {
      role: 'Assistente Administrativo',
      starts_on: '2026-11-01',
      ends_on: '2026-11-30',
      daily_cents: 14000,
      promoted_bonus_cents: 1000,
    },
  ];
  const worker = (overrides = {}) => ({
    role: 'assistente  administrativo',
    promoted_since: null,
    ...overrides,
  });

  it('acha a vigencia da data, com a funcao sem acento nem caixa', () => {
    expect(dailyCentsFor(RATES, worker(), '2026-10-31')).toBe(13000);
    expect(dailyCentsFor(RATES, worker(), '2026-11-01')).toBe(14000);
  });

  it('o adicional de promovido vale a partir da data da promocao', () => {
    const promoted = worker({ promoted_since: '2026-10-20' });

    expect(dailyCentsFor(RATES, promoted, '2026-10-19')).toBe(13000);
    expect(dailyCentsFor(RATES, promoted, '2026-10-20')).toBe(14000);
  });

  it('fora da vigencia, ou sem funcao, nao ha diaria', () => {
    expect(dailyCentsFor(RATES, worker(), '2026-12-01')).toBeNull();
    expect(
      dailyCentsFor(RATES, worker({ role: 'Pedreiro' }), '2026-10-20'),
    ).toBeNull();
    expect(
      dailyCentsFor(RATES, worker({ role: null }), '2026-10-20'),
    ).toBeNull();
  });
});

describe('formatMinutes', () => {
  it.each([
    [480, '8h'],
    [75, '1h15'],
    [45, '45min'],
    [835, '13h55'],
  ])('%i minutos', (minutes, text) => {
    expect(formatMinutes(minutes)).toBe(text);
  });
});
