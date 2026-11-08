'use strict';

const {
  request,
  refusedFields,
  requestUpload,
  insertReport,
  insertRow,
  insertRpaCompany,
  insertRpaLaunch,
  insertRpaPayment,
  insertRpaWorker,
  findReceipts,
  saveUpload,
  uploadedFileExists,
  waitForProcessing,
  currentUser,
} = require('../../orchestrator');
const { makePdf } = require('../../fixtures/pdf');

const SCHEDULE = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  start_time: '08:00',
  lunch_out: '12:00',
  lunch_in: '13:00',
  end_time: '17:00',
}));

const RATES = [
  {
    role: 'Assistente Administrativo',
    starts_on: '2026-10-01',
    ends_on: '2026-10-31',
    daily_cents: 13000,
    promoted_bonus_cents: 1000,
  },
  {
    role: 'Assistente Administrativo',
    starts_on: '2026-11-01',
    ends_on: '2026-11-30',
    daily_cents: 13500,
  },
];

async function validLaunch(overrides = {}) {
  const company = await insertRpaCompany({
    code: 815,
    service_type: 'Prestação de Serviços Administrativos',
    cost_center: '71401',
  });

  return {
    company_id: company.id,
    city: 'Avaré',
    state: 'SP',
    development: 'Residencial Sintetico',
    starts_on: '2026-10-13',
    ends_on: '2026-11-30',
    holidays: ['2026-11-15', '2026-11-02', '2026-11-02'],
    email_to: ['Financeiro@Exemplo.test'],
    schedule: SCHEDULE,
    rates: RATES,
    ...overrides,
  };
}

describe('POST /api/rpa/launches', () => {
  it('cria o lancamento com horario padrao, diarias e o padrao da empresa', async () => {
    const response = await request(
      'POST',
      '/api/rpa/launches',
      await validLaunch(),
    );

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      company_code: 815,
      city: 'Avaré',
      state: 'SP',
      holidays: ['2026-11-02', '2026-11-15'],
      email_to: ['financeiro@exemplo.test'],
      service_type: 'Prestação de Serviços Administrativos',
      cost_center: '71401',
      first_payment_daily_only: true,
      status: 'open',
      created_by: currentUser().id,
    });
    expect(response.body.data.schedule).toHaveLength(5);
    expect(response.body.data.schedule[0]).toEqual({
      weekday: 1,
      quantity: 1,
      start_time: '08:00',
      lunch_out: '12:00',
      lunch_in: '13:00',
      end_time: '17:00',
    });
    expect(response.body.data.rates).toEqual([
      expect.objectContaining({
        daily_cents: 13000,
        promoted_bonus_cents: 1000,
      }),
      expect.objectContaining({ daily_cents: 13500, promoted_bonus_cents: 0 }),
    ]);
    expect(response.headers.get('location')).toBe(
      `/api/rpa/launches/${response.body.data.id}`,
    );
  });

  it('tipo de servico e centro de custo informados valem mais que os da empresa', async () => {
    const response = await request(
      'POST',
      '/api/rpa/launches',
      await validLaunch({ service_type: 'Outro servico', cost_center: null }),
    );

    expect(response.body.data).toMatchObject({
      service_type: 'Outro servico',
      cost_center: null,
    });
  });

  it('empresa inexistente responde 422 no campo', async () => {
    const response = await request(
      'POST',
      '/api/rpa/launches',
      await validLaunch({ company_id: 999999 }),
    );

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      { field: 'company_id', message: 'empresa nao encontrada' },
    ]);
  });

  it('vigencias sobrepostas da mesma funcao respondem 422 apontando a linha', async () => {
    const response = await request(
      'POST',
      '/api/rpa/launches',
      await validLaunch({
        rates: [
          RATES[0],
          {
            ...RATES[1],
            role: 'assistente administrativo',
            starts_on: '2026-10-31',
          },
        ],
      }),
    );

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      {
        field: 'rates[1].starts_on',
        message: 'vigencia sobreposta com rates[0] da mesma funcao',
      },
    ]);
  });

  it('aponta de uma vez o que esta errado no corpo', async () => {
    const response = await request('POST', '/api/rpa/launches', {
      company_id: 'x',
      state: 'XX',
      starts_on: '2026-10-13',
      ends_on: '2026-10-01',
      schedule: [{ weekday: 8, start_time: '25:00', end_time: '17:00' }],
    });

    expect(response.status).toBe(422);
    expect(response.body.details.map((detail) => detail.field)).toEqual([
      'company_id',
      'city',
      'state',
      'development',
      'ends_on',
      'schedule[0].weekday',
      'schedule[0].start_time',
    ]);
  });

  // Cada caso muda um campo do corpo valido. A diaria e o adicional sao
  // dinheiro: inteiro em centavos, e o validador e o que barra o 130.5 antes
  // de ele virar 500 na coluna integer.
  it('cada campo fora do formato responde 422 apontando o campo', async () => {
    const valid = await validLaunch();
    const [rate] = RATES;
    const [monday] = SCHEDULE;
    const post = (change) => () =>
      request('POST', '/api/rpa/launches', { ...valid, ...change });

    const refused = await refusedFields({
      'development longo': post({ development: 'x'.repeat(256) }),
      'holidays sem lista': post({ holidays: '2026-11-15' }),
      'feriado fora do formato': post({ holidays: ['15/11/2026'] }),
      'e-mails demais': post({
        email_to: Array.from({ length: 21 }, (_, i) => `p${i}@exemplo.test`),
      }),
      'e-mail invalido': post({ email_cc: ['sem-arroba'] }),
      'schedule sem lista': post({ schedule: 'segunda' }),
      'dia que nao e objeto': post({ schedule: [1] }),
      'dia repetido': post({ schedule: [monday, monday] }),
      'quantidade fora de 1 ou 0.5': post({
        schedule: [{ ...monday, quantity: 2 }],
      }),
      'rates sem lista': post({ rates: {} }),
      'diaria que nao e objeto': post({ rates: ['130'] }),
      'vigencia ao contrario': post({
        rates: [{ ...rate, starts_on: '2026-10-31', ends_on: '2026-10-01' }],
      }),
      'diaria em reais': post({ rates: [{ ...rate, daily_cents: 130.5 }] }),
      'diaria zero': post({ rates: [{ ...rate, daily_cents: 0 }] }),
      'adicional fracionado': post({
        rates: [{ ...rate, promoted_bonus_cents: 10.5 }],
      }),
      'primeiro pagamento sem booleano': post({
        first_payment_daily_only: 'sim',
      }),
    });

    expect(refused).toEqual({
      'development longo': ['development'],
      'holidays sem lista': ['holidays'],
      'feriado fora do formato': ['holidays'],
      'e-mails demais': ['email_to'],
      'e-mail invalido': ['email_cc'],
      'schedule sem lista': ['schedule'],
      'dia que nao e objeto': ['schedule[0]'],
      'dia repetido': ['schedule[1].weekday'],
      'quantidade fora de 1 ou 0.5': ['schedule[0].quantity'],
      'rates sem lista': ['rates'],
      'diaria que nao e objeto': ['rates[0]'],
      'vigencia ao contrario': ['rates[0].ends_on'],
      'diaria em reais': ['rates[0].daily_cents'],
      'diaria zero': ['rates[0].daily_cents'],
      'adicional fracionado': ['rates[0].promoted_bonus_cents'],
      'primeiro pagamento sem booleano': ['first_payment_daily_only'],
    });
  });

  it('o horario padrao segue a mesma regra de ordem da grade do ponto', async () => {
    const response = await request(
      'POST',
      '/api/rpa/launches',
      await validLaunch({
        schedule: [
          { ...SCHEDULE[0], end_time: '08:00' },
          // Turno da noite: a saida no dia seguinte vale.
          {
            weekday: 2,
            start_time: '22:00',
            lunch_out: '02:00',
            lunch_in: '03:00',
            end_time: '07:00',
          },
        ],
      }),
    );

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      {
        field: 'schedule[0].start_time',
        message: 'a jornada chega a 24h: confira a ordem dos horarios',
      },
    ]);
  });
});

describe('GET /api/rpa/launches', () => {
  it('lista do mais novo para o mais velho, e filtra pelo status', async () => {
    await insertRpaLaunch({ starts_on: '2026-08-05', ends_on: '2026-09-02' });
    await insertRpaLaunch({ starts_on: '2026-10-13', status: 'closed' });

    const all = await request('GET', '/api/rpa/launches');
    const open = await request('GET', '/api/rpa/launches?status=open');

    expect(all.body.data.map((launch) => launch.starts_on)).toEqual([
      '2026-10-13',
      '2026-08-05',
    ]);
    expect(all.body.meta).toEqual({ total: 2, limit: 50, offset: 0 });
    expect(open.body.meta.total).toBe(1);
  });
});

describe('PATCH /api/rpa/launches/:id', () => {
  it('substitui o horario e as diarias quando vem', async () => {
    const created = await request(
      'POST',
      '/api/rpa/launches',
      await validLaunch(),
    );

    const response = await request(
      'PATCH',
      `/api/rpa/launches/${created.body.data.id}`,
      {
        schedule: [
          { weekday: 6, quantity: 0.5, start_time: '08:00', end_time: '12:00' },
        ],
        rates: [],
      },
    );

    expect(response.status).toBe(200);
    expect(response.body.data.schedule).toEqual([
      {
        weekday: 6,
        quantity: 0.5,
        start_time: '08:00',
        lunch_out: null,
        lunch_in: null,
        end_time: '12:00',
      },
    ]);
    expect(response.body.data.rates).toEqual([]);
  });

  it('confere o periodo contra o que ja esta gravado', async () => {
    const launch = await insertRpaLaunch();

    const response = await request('PATCH', `/api/rpa/launches/${launch.id}`, {
      ends_on: '2026-10-01',
    });

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      { field: 'ends_on', message: 'ends_on antes de starts_on' },
    ]);
  });

  it('estado, status e o filtro da listagem fora do formato respondem 422 no campo', async () => {
    const launch = await insertRpaLaunch();
    const patch = (body) => () =>
      request('PATCH', `/api/rpa/launches/${launch.id}`, body);

    const refused = await refusedFields({
      'estado em branco': patch({ state: ' ' }),
      'estado que nao existe': patch({ state: 'XX' }),
      'status fora do enum': patch({ status: 'paused' }),
      'filtro de status': () =>
        request('GET', '/api/rpa/launches?status=paused'),
      'previa fora de true ou false': () =>
        request('PATCH', `/api/rpa/launches/${launch.id}?preview=talvez`, {
          development: 'Outro',
        }),
    });

    expect(refused).toEqual({
      'estado em branco': ['state'],
      'estado que nao existe': ['state'],
      'status fora do enum': ['status'],
      'filtro de status': ['status'],
      'previa fora de true ou false': ['preview'],
    });
  });

  it('encerrado so aceita reabrir', async () => {
    const launch = await insertRpaLaunch({ status: 'closed' });

    const edit = await request('PATCH', `/api/rpa/launches/${launch.id}`, {
      development: 'Outro',
    });
    const reopen = await request('PATCH', `/api/rpa/launches/${launch.id}`, {
      status: 'open',
    });

    expect(edit.status).toBe(409);
    expect(reopen.status).toBe(200);
    expect(reopen.body.data.status).toBe('open');
  });
});

describe('PATCH /api/rpa/launches/:id?preview=true: o efeito nos dias ja pagos (issue 71)', () => {
  const PAID_WEEK = [
    '2026-10-13',
    '2026-10-14',
    '2026-10-15',
    '2026-10-16',
    '2026-10-19',
  ];
  const RATE = {
    role: 'Assistente Administrativo',
    starts_on: '2026-10-13',
    ends_on: '2026-10-30',
    daily_cents: 11000,
  };

  // Dias de 8h, so a diaria de R$ 110,00; a primeira semana paga para duas
  // pessoas.
  async function arrangePaidWeek() {
    const created = await request(
      'POST',
      '/api/rpa/launches',
      await validLaunch({
        ends_on: '2026-10-30',
        holidays: [],
        rates: [RATE],
        first_payment_daily_only: false,
      }),
    );
    const launch = created.body.data;
    const workers = [
      await insertRpaWorker({ launch_id: launch.id, number: 1 }),
      await insertRpaWorker({
        launch_id: launch.id,
        number: 2,
        cpf: '11144477735',
      }),
    ];
    const paid = await request(
      'POST',
      `/api/rpa/launches/${launch.id}/payments`,
      {
        period_start: '2026-10-13',
        period_end: '2026-10-19',
        payment_date: '2026-10-20',
      },
    );
    expect(paid.status).toBe(201);

    return { launch, workers };
  }

  const preview = (launchId, body) =>
    request('PATCH', `/api/rpa/launches/${launchId}?preview=true`, body);

  it('trocar o valor da vigencia que ja pagou: o efeito por pessoa, e nada e gravado', async () => {
    const { launch, workers } = await arrangePaidWeek();

    const response = await preview(launch.id, {
      rates: [{ ...RATE, daily_cents: 12000 }],
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      preview: true,
      effect: {
        days: 10,
        people: 2,
        value_cents: 2 * 5 * 1000,
        workers: workers.map((worker) => ({
          worker_id: worker.id,
          worker_number: worker.number,
          worker_name: worker.name,
          days: PAID_WEEK,
          unpriced_days: [],
          value_cents: 5 * 1000,
        })),
      },
    });

    const shown = await request('GET', `/api/rpa/launches/${launch.id}`);
    expect(shown.body.data.rates).toEqual([
      expect.objectContaining({ daily_cents: 11000 }),
    ]);
    const balances = await request(
      'GET',
      `/api/rpa/launches/${launch.id}/balances`,
    );
    expect(balances.body.data).toEqual([]);
  });

  it('fechar a vigencia e abrir outra depois dos dias pagos nao muda nada pago', async () => {
    const { launch } = await arrangePaidWeek();

    const response = await preview(launch.id, {
      rates: [
        { ...RATE, ends_on: '2026-10-20' },
        { ...RATE, starts_on: '2026-10-21', daily_cents: 12000 },
      ],
    });

    expect(response.body.data.effect).toEqual({
      days: 0,
      people: 0,
      value_cents: 0,
      workers: [],
    });
  });

  it('feriado num dia pago dobra a diaria; horario maior da extra em todos', async () => {
    const { launch } = await arrangePaidWeek();

    const holiday = await preview(launch.id, { holidays: ['2026-10-15'] });

    expect(holiday.body.data.effect).toMatchObject({
      days: 2,
      people: 2,
      value_cents: 2 * 11000,
    });
    expect(
      holiday.body.data.effect.workers.map((worker) => worker.days),
    ).toEqual([['2026-10-15'], ['2026-10-15']]);

    // Saida as 18h: 1h a 50% sobre R$ 110,00 (R$ 20,625) nos 5 dias.
    const longer = await preview(launch.id, {
      schedule: SCHEDULE.map((day) => ({ ...day, end_time: '18:00' })),
    });

    expect(longer.body.data.effect).toMatchObject({
      days: 10,
      people: 2,
      value_cents: 2 * 10313,
    });
  });

  it('tirar a vigencia que cobre dia pago aponta os dias que ficariam sem diaria', async () => {
    const { launch } = await arrangePaidWeek();

    const response = await preview(launch.id, { rates: [] });

    expect(response.body.data.effect).toMatchObject({ days: 10, people: 2 });
    expect(
      response.body.data.effect.workers.map((worker) => worker.unpriced_days),
    ).toEqual([PAID_WEEK, PAID_WEEK]);
  });

  it('mudanca que nao toca dia pago, ou lancamento sem pagamento, nao tem efeito', async () => {
    const { launch } = await arrangePaidWeek();
    const fresh = await insertRpaLaunch();
    const none = { days: 0, people: 0, value_cents: 0, workers: [] };

    const renamed = await preview(launch.id, { development: 'Outro nome' });
    const unpaid = await preview(fresh.id, { rates: [] });

    expect(renamed.body.data.effect).toEqual(none);
    expect(unpaid.body.data.effect).toEqual(none);
  });
});

describe('DELETE /api/rpa/launches/:id', () => {
  it('apaga o lancamento e a equipe junto', async () => {
    const worker = await insertRpaWorker();

    const deleted = await request(
      'DELETE',
      `/api/rpa/launches/${worker.launch_id}`,
    );
    const lookup = await request('GET', `/api/rpa/workers/${worker.id}`);

    expect(deleted.status).toBe(204);
    expect(lookup.status).toBe(404);
  });

  it('com RPA emitido, mesmo cancelado, recusa com 409', async () => {
    const payment = await insertRpaPayment({
      status: 'canceled',
      canceled_at: new Date(),
      cancel_reason: 'periodo errado',
    });
    const { body } = await request(
      'GET',
      `/api/rpa/workers/${payment.worker_id}`,
    );

    const response = await request(
      'DELETE',
      `/api/rpa/launches/${body.data.launch_id}`,
    );

    expect(response.status).toBe(409);
    expect(response.body.action).toBe(
      'Encerre o lancamento em vez de apaga-lo.',
    );
  });
});

describe('retencao dos arquivos do lancamento', () => {
  function rpaFile(launchId, file) {
    return insertRow('rpa_files', {
      launch_id: launchId,
      kind: 'ctps',
      file_hash: file.file_hash,
      file_path: file.file_path,
      content_type: 'application/pdf',
      byte_size: 1024,
    });
  }

  it('apagar o lancamento apaga do disco o documento que so ele guardava', async () => {
    const launch = await insertRpaLaunch();
    const file = saveUpload(await makePdf({ text: 'documento sintetico' }));
    await rpaFile(launch.id, file);

    expect(uploadedFileExists(file.file_hash)).toBe(true);

    await request('DELETE', `/api/rpa/launches/${launch.id}`);

    expect(uploadedFileExists(file.file_hash)).toBe(false);
  });

  it('o arquivo que um comprovante tambem guarda sobrevive a exclusao do lancamento', async () => {
    // O outro lado do teste de tests/api/receipts/delete.test.js: a contagem
    // de referencias soma comprovantes e arquivos do RPA (issue 36).
    const report = await insertReport();
    await requestUpload(`/api/reports/${report.id}/receipts`, [
      { buffer: await makePdf({ text: 'compartilhado' }), filename: 'a.pdf' },
    ]);
    await waitForProcessing(report.id);
    const [receipt] = await findReceipts(report.id);
    const launch = await insertRpaLaunch();
    await rpaFile(launch.id, receipt);

    await request('DELETE', `/api/rpa/launches/${launch.id}`);

    expect(uploadedFileExists(receipt.file_hash)).toBe(true);
  });
});
