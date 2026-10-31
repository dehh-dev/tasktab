'use strict';

const {
  request,
  insertRow,
  insertRpaLaunch,
  insertRpaWorker,
} = require('../../orchestrator');

// A unidade do calculo: 1/1920 de centavo (ver `src/services/rpa/day-value.js`).
const subcents = (reais) => Math.round(reais * 100 * 1920);

const FULL_DAY = {
  quantity: 1,
  start_time: '08:00',
  lunch_out: '12:00',
  lunch_in: '13:00',
  end_time: '17:00',
};

/**
 * O lancamento dos criterios da issue 38: diaria de R$ 130,00, segunda a
 * sexta das 8h as 17h com 1h de almoco, sabado e domingo de folga, Finados
 * como feriado. A diaria vale ate 15/11.
 */
async function arrangeLaunch(overrides = {}) {
  const launch = await insertRpaLaunch({
    starts_on: '2026-10-13',
    ends_on: '2026-11-30',
    holidays: ['2026-11-02'],
    ...overrides,
  });

  for (const weekday of [1, 2, 3, 4, 5]) {
    await insertRow('rpa_launch_schedules', {
      launch_id: launch.id,
      weekday,
      ...FULL_DAY,
    });
  }

  await insertRow('rpa_rates', {
    launch_id: launch.id,
    role: 'Ajudante',
    starts_on: '2026-10-13',
    ends_on: '2026-11-15',
    daily_cents: 13000,
  });

  return launch;
}

function arrangeWorker(launch, overrides = {}) {
  return insertRpaWorker({
    launch_id: launch.id,
    role: 'Ajudante',
    starts_on: '2026-10-13',
    ...overrides,
  });
}

function grid(launchId, query = '') {
  return request('GET', `/api/rpa/launches/${launchId}/days${query}`);
}

function save(launchId, days) {
  return request('PUT', `/api/rpa/launches/${launchId}/days`, { days });
}

function dayOf(body, workerId, date) {
  return body.data.workers
    .find((worker) => worker.id === workerId)
    .days.find((day) => day.date === date);
}

describe('GET /api/rpa/launches/:id/days', () => {
  it('vem preenchida pelo horario padrao, com o inicio, a saida e a folga de cada pessoa', async () => {
    const launch = await arrangeLaunch();
    const early = await arrangeWorker(launch, { number: 1 });
    const late = await arrangeWorker(launch, {
      number: 2,
      cpf: '11144477735',
      starts_on: '2026-10-16',
      left_on: '2026-10-20',
    });

    const response = await grid(launch.id, '?from=2026-10-13&to=2026-10-20');

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      from: '2026-10-13',
      to: '2026-10-20',
      subcents_per_cent: 1920,
    });

    const rows = Object.fromEntries(
      response.body.data.workers.map((worker) => [
        worker.number,
        worker.days.map((day) => `${day.date} ${day.source}`),
      ]),
    );
    expect(rows).toEqual({
      1: [
        '2026-10-13 schedule',
        '2026-10-14 schedule',
        '2026-10-15 schedule',
        '2026-10-16 schedule',
        '2026-10-17 off',
        '2026-10-18 off',
        '2026-10-19 schedule',
        '2026-10-20 schedule',
      ],
      2: [
        '2026-10-16 schedule',
        '2026-10-17 off',
        '2026-10-18 off',
        '2026-10-19 schedule',
        '2026-10-20 schedule',
      ],
    });

    const [first] = response.body.data.workers;
    expect(first.id).toBe(early.id);
    expect(first.totals).toEqual({
      quantity: 6,
      daily_subcents: subcents(6 * 130),
      extra_subcents: 0,
      value_subcents: subcents(6 * 130),
      days_without_rate: 0,
    });
    expect(response.body.data.workers[1].id).toBe(late.id);
  });

  it('nao traz CPF, conta nem documento da pessoa', async () => {
    const launch = await arrangeLaunch();
    await arrangeWorker(launch, { account: '1234567-8', rg: '123456789' });

    const response = await grid(launch.id, '?to=2026-10-13');

    expect(Object.keys(response.body.data.workers[0]).sort()).toEqual([
      'days',
      'id',
      'left_on',
      'name',
      'number',
      'promoted_since',
      'role',
      'starts_on',
      'totals',
    ]);
  });

  it('sem from e to, e o lancamento inteiro', async () => {
    const launch = await arrangeLaunch();
    await arrangeWorker(launch);

    const response = await grid(launch.id);

    expect(response.body.data).toMatchObject({
      from: '2026-10-13',
      to: '2026-11-30',
    });
    expect(response.body.data.workers[0].days).toHaveLength(49);
  });

  it('o dia depois do fim da diaria fica sem valor e marcado', async () => {
    const launch = await arrangeLaunch();
    const worker = await arrangeWorker(launch);

    const response = await grid(launch.id, '?from=2026-11-13&to=2026-11-16');

    expect(dayOf(response.body, worker.id, '2026-11-13').value_subcents).toBe(
      subcents(130),
    );
    expect(dayOf(response.body, worker.id, '2026-11-16')).toMatchObject({
      value_subcents: null,
      flags: [{ code: 'no_rate' }],
    });
    expect(response.body.data.workers[0].totals.days_without_rate).toBe(1);
  });

  it('o valor e calculado na leitura: mudar a diaria do lancamento ja muda a grade', async () => {
    const launch = await arrangeLaunch();
    const worker = await arrangeWorker(launch);

    await request('PATCH', `/api/rpa/launches/${launch.id}`, {
      rates: [
        {
          role: 'Ajudante',
          starts_on: '2026-10-13',
          ends_on: '2026-11-30',
          daily_cents: 14000,
        },
      ],
    });
    const response = await grid(launch.id, '?from=2026-10-13&to=2026-10-13');

    expect(dayOf(response.body, worker.id, '2026-10-13').value_subcents).toBe(
      subcents(140),
    );
  });

  it.each([
    ['from invalido', '?from=2026-13-01', 'from'],
    ['to antes de from', '?from=2026-10-20&to=2026-10-19', 'to'],
    ['fora do lancamento', '?from=2026-12-01&to=2026-12-31', 'from'],
  ])('%s responde 422 no campo', async (_, query, field) => {
    const launch = await arrangeLaunch();

    const response = await grid(launch.id, query);

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([expect.objectContaining({ field })]);
  });

  it('recorte de mais de 93 dias responde 422 com o que fazer', async () => {
    const launch = await arrangeLaunch({ ends_on: '2027-03-31' });

    const response = await grid(launch.id);

    expect(response.status).toBe(422);
    expect(response.body.message).toBe(
      'O recorte tem 170 dias; o maximo e 93.',
    );
    expect(response.body.action).toBe('Informe from e to com ate 93 dias.');
  });
});

describe('PUT /api/rpa/launches/:id/days: os criterios da issue 38', () => {
  it.each([
    [
      'dia util 8h-18h com 1h de almoco',
      '2026-10-14',
      { ...FULL_DAY, end_time: '18:00' },
      154.375,
    ],
    [
      'dia util 5h45-20h com 20 min de almoco (13h55)',
      '2026-10-15',
      {
        quantity: 1,
        start_time: '05:45',
        lunch_out: '12:00',
        lunch_in: '12:20',
        end_time: '20:00',
      },
      274.21875,
    ],
    [
      'sabado com 9h45',
      '2026-10-17',
      { ...FULL_DAY, start_time: '07:00', end_time: '17:45' },
      172.65625,
    ],
    [
      'domingo com 9h45',
      '2026-10-18',
      { ...FULL_DAY, start_time: '07:00', end_time: '17:45' },
      316.875,
    ],
    ['feriado com 9h', '2026-11-02', { ...FULL_DAY, end_time: '18:00' }, 292.5],
    [
      'meio periodo de 4h',
      '2026-10-16',
      { quantity: 0.5, start_time: '08:00', end_time: '12:00' },
      65,
    ],
  ])('%s', async (_, date, times, reais) => {
    const launch = await arrangeLaunch();
    const worker = await arrangeWorker(launch);

    const response = await save(launch.id, [
      { worker_id: worker.id, date, ...times },
    ]);

    expect(response.status).toBe(200);
    expect(dayOf(response.body, worker.id, date)).toMatchObject({
      source: 'exception',
      value_subcents: subcents(reais),
    });
  });
});

describe('PUT /api/rpa/launches/:id/days', () => {
  it('grava a falta e o horario diferente, e a grade passa a mostrar os dois', async () => {
    const launch = await arrangeLaunch();
    const worker = await arrangeWorker(launch);

    const response = await save(launch.id, [
      {
        worker_id: worker.id,
        date: '2026-10-14',
        quantity: 0,
        note: 'atestado',
      },
      {
        worker_id: worker.id,
        date: '2026-10-15',
        ...FULL_DAY,
        end_time: '19:00',
      },
    ]);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      from: '2026-10-14',
      to: '2026-10-15',
    });

    const after = await grid(launch.id, '?from=2026-10-13&to=2026-10-16');
    expect(
      after.body.data.workers[0].days.map((day) => [
        day.date,
        day.source,
        day.quantity,
        day.end_time,
        day.note,
      ]),
    ).toEqual([
      ['2026-10-13', 'schedule', 1, '17:00', null],
      ['2026-10-14', 'exception', 0, null, 'atestado'],
      ['2026-10-15', 'exception', 1, '19:00', null],
      ['2026-10-16', 'schedule', 1, '17:00', null],
    ]);
  });

  it('o dia que ninguem trabalharia (folga) pode virar dia trabalhado', async () => {
    const launch = await arrangeLaunch();
    const worker = await arrangeWorker(launch);

    const response = await save(launch.id, [
      { worker_id: worker.id, date: '2026-10-18', ...FULL_DAY },
    ]);

    expect(dayOf(response.body, worker.id, '2026-10-18')).toMatchObject({
      kind: 'sunday',
      source: 'exception',
      value_subcents: subcents(260),
    });
  });

  it('tirar a excecao volta o dia ao padrao', async () => {
    const launch = await arrangeLaunch();
    const worker = await arrangeWorker(launch);
    await save(launch.id, [
      { worker_id: worker.id, date: '2026-10-14', quantity: 0 },
    ]);

    const response = await save(launch.id, [
      { worker_id: worker.id, date: '2026-10-14', reset: true },
    ]);

    expect(dayOf(response.body, worker.id, '2026-10-14')).toMatchObject({
      source: 'schedule',
      quantity: 1,
      value_subcents: subcents(130),
    });
  });

  it('mandar o dia igual ao padrao tambem volta ao padrao, sem gravar excecao', async () => {
    const launch = await arrangeLaunch();
    const worker = await arrangeWorker(launch);
    await save(launch.id, [
      {
        worker_id: worker.id,
        date: '2026-10-14',
        ...FULL_DAY,
        end_time: '18:00',
      },
    ]);

    const response = await save(launch.id, [
      { worker_id: worker.id, date: '2026-10-14', ...FULL_DAY },
    ]);

    expect(dayOf(response.body, worker.id, '2026-10-14').source).toBe(
      'schedule',
    );
  });

  it('dia fora da vigencia da diaria responde 422 com a data e a funcao, e nada do lote e gravado', async () => {
    const launch = await arrangeLaunch();
    const worker = await arrangeWorker(launch);

    const response = await save(launch.id, [
      { worker_id: worker.id, date: '2026-10-14', quantity: 0 },
      {
        worker_id: worker.id,
        date: '2026-11-20',
        ...FULL_DAY,
        end_time: '18:00',
      },
    ]);

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      {
        field: 'days[1].date',
        message: 'sem diaria vigente para "Ajudante" em 2026-11-20',
        date: '2026-11-20',
        role: 'Ajudante',
      },
    ]);
    expect(response.body.action).toBe(
      'Corrija os dias indicados; nenhum dia do lote foi gravado.',
    );

    const after = await grid(launch.id, '?from=2026-10-14&to=2026-10-14');
    expect(dayOf(after.body, worker.id, '2026-10-14').source).toBe('schedule');
  });

  it('a falta fora da vigencia nao precisa de diaria', async () => {
    const launch = await arrangeLaunch();
    const worker = await arrangeWorker(launch);

    const response = await save(launch.id, [
      { worker_id: worker.id, date: '2026-11-20', quantity: 0 },
    ]);

    expect(response.status).toBe(200);
  });

  it('pessoa de outro lancamento e dia fora do periodo da pessoa respondem 422 na linha', async () => {
    const launch = await arrangeLaunch();
    const worker = await arrangeWorker(launch, { left_on: '2026-10-20' });
    const stranger = await arrangeWorker(await arrangeLaunch());

    const response = await save(launch.id, [
      { worker_id: stranger.id, date: '2026-10-14', quantity: 0 },
      { worker_id: worker.id, date: '2026-10-21', quantity: 0 },
    ]);

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      {
        field: 'days[0].worker_id',
        message: 'a pessoa nao e deste lancamento',
      },
      {
        field: 'days[1].date',
        message: 'fora do periodo da pessoa (2026-10-13 a 2026-10-20)',
      },
    ]);
  });

  it('a excecao de quem teve a saida antecipada ainda pode ser tirada', async () => {
    const launch = await arrangeLaunch();
    const worker = await arrangeWorker(launch);
    await save(launch.id, [
      { worker_id: worker.id, date: '2026-10-21', quantity: 0 },
    ]);
    await request('PATCH', `/api/rpa/workers/${worker.id}`, {
      left_on: '2026-10-20',
    });

    const response = await save(launch.id, [
      { worker_id: worker.id, date: '2026-10-21', reset: true },
    ]);

    expect(response.status).toBe(200);
  });

  it('aponta de uma vez cada dia errado do corpo', async () => {
    const launch = await arrangeLaunch();
    const worker = await arrangeWorker(launch);

    const response = await save(launch.id, [
      {
        worker_id: worker.id,
        date: '2026-10-14',
        quantity: 0,
        start_time: '08:00',
      },
      { worker_id: worker.id, date: '2026-10-15', quantity: 2 },
      {
        worker_id: worker.id,
        date: '2026-10-16',
        quantity: 1,
        start_time: '08:00',
      },
      { worker_id: worker.id, date: '2026-10-19', ...FULL_DAY, lunch_in: null },
      {
        worker_id: worker.id,
        date: '2026-10-20',
        ...FULL_DAY,
        end_time: '08:00',
      },
      { worker_id: worker.id, date: '2026-10-20', quantity: 0 },
      { worker_id: worker.id, date: '2026-02-30', quantity: 0 },
      { worker_id: worker.id, date: '2026-10-21', reset: 'sim' },
      'segunda',
    ]);

    expect(response.status).toBe(422);
    expect(response.body.details.map((detail) => detail.field)).toEqual([
      'days[0].start_time',
      'days[1].quantity',
      'days[2].end_time',
      'days[3].lunch_out',
      'days[4].start_time',
      'days[5].date',
      'days[6].date',
      'days[7].reset',
      'days[8]',
    ]);
  });

  it.each([
    ['sem days', {}],
    ['days vazio', { days: [] }],
    ['days demais', { days: Array.from({ length: 1001 }, () => ({})) }],
  ])('%s responde 422 em days', async (_, body) => {
    const launch = await arrangeLaunch();

    const response = await request(
      'PUT',
      `/api/rpa/launches/${launch.id}/days`,
      body,
    );

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      { field: 'days', message: 'days deve ser uma lista de 1 a 1000 dias' },
    ]);
  });

  it('lancamento encerrado recusa com 409', async () => {
    const launch = await arrangeLaunch({ status: 'closed' });
    const worker = await arrangeWorker(launch);

    const response = await save(launch.id, [
      { worker_id: worker.id, date: '2026-10-14', quantity: 0 },
    ]);

    expect(response.status).toBe(409);
  });
});
