'use strict';

const {
  request,
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
