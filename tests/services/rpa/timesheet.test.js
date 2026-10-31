'use strict';

const {
  workerPeriod,
  sameAsPlanned,
  buildGrid,
} = require('../../../src/services/rpa/timesheet');
const { SUBCENTS_PER_CENT } = require('../../../src/services/rpa/day-value');

const subcents = (reais) => Math.round(reais * 100 * SUBCENTS_PER_CENT);

const WEEKDAY = {
  quantity: 1,
  start_time: '08:00',
  lunch_out: '12:00',
  lunch_in: '13:00',
  end_time: '17:00',
};

// Segunda a sexta 8h, sabado meio periodo, domingo de folga.
const LAUNCH = {
  starts_on: '2026-10-13',
  ends_on: '2026-10-25',
  holidays: ['2026-10-23'],
  schedule: [
    ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, ...WEEKDAY })),
    {
      weekday: 6,
      quantity: 0.5,
      start_time: '08:00',
      lunch_out: null,
      lunch_in: null,
      end_time: '12:00',
    },
  ],
  rates: [
    {
      role: 'Ajudante',
      starts_on: '2026-10-13',
      ends_on: '2026-10-21',
      daily_cents: 13000,
      promoted_bonus_cents: 0,
    },
  ],
};

const worker = (overrides = {}) => ({
  id: 1,
  number: 1,
  name: 'Pessoa Sintetica',
  role: 'Ajudante',
  starts_on: null,
  left_on: null,
  promoted_since: null,
  ...overrides,
});

function grid({ workers = [worker()], exceptions = [], from, to } = {}) {
  return buildGrid({
    launch: LAUNCH,
    workers,
    exceptions,
    from: from ?? LAUNCH.starts_on,
    to: to ?? LAUNCH.ends_on,
  });
}

describe('workerPeriod', () => {
  it('vai do inicio da pessoa a saida dela, dentro do lancamento', () => {
    expect(
      workerPeriod(
        LAUNCH,
        worker({ starts_on: '2026-10-15', left_on: '2026-10-20' }),
      ),
    ).toEqual({ first: '2026-10-15', last: '2026-10-20' });
    expect(workerPeriod(LAUNCH, worker({ starts_on: '2026-10-01' }))).toEqual({
      first: '2026-10-13',
      last: '2026-10-25',
    });
  });

  it('quem saiu antes do lancamento comecar nao tem dia', () => {
    expect(workerPeriod(LAUNCH, worker({ left_on: '2026-10-12' }))).toBeNull();
  });
});

describe('buildGrid', () => {
  it('preenche pelo horario padrao, com a folga e o inicio e a saida da pessoa', () => {
    const [row] = grid({
      workers: [worker({ starts_on: '2026-10-16', left_on: '2026-10-19' })],
    }).workers;

    expect(row.days.map((day) => [day.date, day.source, day.quantity])).toEqual(
      [
        ['2026-10-16', 'schedule', 1],
        ['2026-10-17', 'schedule', 0.5],
        ['2026-10-18', 'off', 0],
        ['2026-10-19', 'schedule', 1],
      ],
    );
    expect(row.totals).toMatchObject({
      quantity: 2.5,
      value_subcents: subcents(130 + 65 + 130),
      days_without_rate: 0,
    });
  });

  it('a excecao vale no lugar do padrao, com a observacao', () => {
    const [row] = grid({
      exceptions: [
        {
          worker_id: 1,
          work_date: '2026-10-14',
          quantity: 0,
          start_time: null,
          lunch_out: null,
          lunch_in: null,
          end_time: null,
          note: 'atestado',
        },
      ],
      from: '2026-10-14',
      to: '2026-10-14',
    }).workers;

    expect(row.days).toEqual([
      expect.objectContaining({
        source: 'exception',
        quantity: 0,
        note: 'atestado',
        value_subcents: 0,
        flags: [],
      }),
    ]);
  });

  it('feriado no dia de semana vem pelo horario padrao, dobrado', () => {
    const [row] = grid({ from: '2026-10-23', to: '2026-10-23' }).workers;

    expect(row.days[0]).toMatchObject({ kind: 'holiday', source: 'schedule' });
  });

  it('dia sem diaria vigente fica sem valor e marcado, e os outros somam', () => {
    const [row] = grid({ from: '2026-10-21', to: '2026-10-22' }).workers;

    expect(row.days.map((day) => day.value_subcents)).toEqual([
      subcents(130),
      null,
    ]);
    expect(row.days[1].flags).toEqual([
      {
        code: 'no_rate',
        message: 'sem diaria vigente para "Ajudante" em 2026-10-22',
      },
    ]);
    expect(row.totals).toMatchObject({
      value_subcents: subcents(130),
      days_without_rate: 1,
    });
  });

  it('a folga nao precisa de diaria', () => {
    const [row] = grid({ from: '2026-10-25', to: '2026-10-25' }).workers;

    expect(row.days[0]).toMatchObject({
      source: 'off',
      value_subcents: 0,
      flags: [],
    });
  });

  it('dia curto e turno da noite saem marcados', () => {
    const [row] = grid({
      exceptions: [
        {
          worker_id: 1,
          work_date: '2026-10-14',
          quantity: 1,
          start_time: '20:00',
          lunch_out: null,
          lunch_in: null,
          end_time: '02:00',
          note: null,
        },
      ],
      from: '2026-10-14',
      to: '2026-10-14',
    }).workers;

    expect(row.days[0].flags.map((flag) => flag.code)).toEqual([
      'short_day',
      'overnight',
    ]);
    expect(row.days[0].flags[0].message).toBe('6h de 8h: nao desconta sozinho');
    expect(row.days[0].value_subcents).toBe(subcents(130));
  });

  it('o recorte so devolve os feriados de dentro dele', () => {
    expect(grid({ from: '2026-10-13', to: '2026-10-20' }).holidays).toEqual([]);
    expect(grid().holidays).toEqual(['2026-10-23']);
  });
});

describe('sameAsPlanned', () => {
  it('o dia igual ao padrao, sem observacao, nao e excecao', () => {
    expect(
      sameAsPlanned({ ...WEEKDAY, note: null }, LAUNCH, '2026-10-14'),
    ).toBe(true);
    expect(
      sameAsPlanned({ quantity: 0, note: null }, LAUNCH, '2026-10-18'),
    ).toBe(true);
  });

  it('horario, quantidade ou observacao diferentes sao excecao', () => {
    expect(
      sameAsPlanned(
        { ...WEEKDAY, end_time: '18:00', note: null },
        LAUNCH,
        '2026-10-14',
      ),
    ).toBe(false);
    expect(
      sameAsPlanned(
        { ...WEEKDAY, note: 'chegou de onibus' },
        LAUNCH,
        '2026-10-14',
      ),
    ).toBe(false);
    expect(
      sameAsPlanned({ ...WEEKDAY, note: null }, LAUNCH, '2026-10-18'),
    ).toBe(false);
  });
});
