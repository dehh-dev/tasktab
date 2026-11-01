'use strict';

const {
  request,
  insertRow,
  insertRpaCompany,
  insertRpaLaunch,
  insertRpaWorker,
  updateColumnDirectly,
} = require('../../orchestrator');

/**
 * O lancamento dos criterios da issue 39: diaria de R$ 130,00, segunda a
 * sexta das 8h as 18h com 1h de almoco (9h, 1h de extra a 50% por dia),
 * sabado e domingo de folga, "1o pagamento so com diarias" ligado.
 */
const NINE_HOURS = {
  quantity: 1,
  start_time: '08:00',
  lunch_out: '12:00',
  lunch_in: '13:00',
  end_time: '18:00',
};

const FIRST_WEEK = { period_start: '2026-10-13', period_end: '2026-10-19' };

// O codigo UAU e unico: um por empresa criada no teste.
let nextCompanyCode = 800;

async function arrangeLaunch(overrides = {}) {
  nextCompanyCode += 1;
  const company =
    overrides.company ?? (await insertRpaCompany({ code: nextCompanyCode }));
  const launch = await insertRpaLaunch({
    starts_on: '2026-10-13',
    ends_on: '2026-11-30',
    ...overrides.launch,
    company_id: company.id,
  });

  for (const weekday of [1, 2, 3, 4, 5]) {
    await insertRow('rpa_launch_schedules', {
      launch_id: launch.id,
      weekday,
      ...NINE_HOURS,
    });
  }

  await insertRow('rpa_rates', {
    launch_id: launch.id,
    role: 'Ajudante',
    starts_on: '2026-10-13',
    ends_on: '2026-11-15',
    daily_cents: 13000,
  });

  return { company, launch };
}

function arrangeWorker(launch, overrides = {}) {
  return insertRpaWorker({
    launch_id: launch.id,
    number: 7,
    role: 'Ajudante',
    starts_on: '2026-10-13',
    ...overrides,
  });
}

function pay(launchId, body, { preview = false } = {}) {
  return request(
    'POST',
    `/api/rpa/launches/${launchId}/payments${preview ? '?preview=true' : ''}`,
    { payment_date: '2026-10-20', ...body },
  );
}

function saveDays(launchId, days) {
  return request('PUT', `/api/rpa/launches/${launchId}/days`, { days });
}

const subcents = (reais) => Math.round(reais * 100 * 1920);

describe('POST /api/rpa/launches/:id/payments: os criterios da issue 39', () => {
  it('1o pagamento de 5 dias uteis de 9h, so com diarias: R$ 650,00, e os R$ 121,875 de extra ficam pendentes', async () => {
    const { company, launch } = await arrangeLaunch();
    const worker = await arrangeWorker(launch);

    const response = await pay(launch.id, FIRST_WEEK);

    expect(response.status).toBe(201);
    expect(response.body.data.payments).toEqual([
      expect.objectContaining({
        worker_id: worker.id,
        number: 1,
        code: `1-${company.code}-7-102026`,
        value_cents: 65000,
        net_cents: 65000,
        // Arredondado daria 730,34 e INSS 80,34, como a planilha.
        gross_cents: 73033,
        inss_cents: 8033,
        irrf_cents: 0,
        deferred_extra_subcents: subcents(121.875),
      }),
    ]);
  });

  it('o seguinte, com um dia util de 8h, um sabado de 9h45 e os extras pendentes: R$ 424,53', async () => {
    const { launch } = await arrangeLaunch();
    const worker = await arrangeWorker(launch);
    await pay(launch.id, FIRST_WEEK);
    await saveDays(launch.id, [
      {
        worker_id: worker.id,
        date: '2026-10-23',
        ...NINE_HOURS,
        end_time: '17:00',
      },
      {
        worker_id: worker.id,
        date: '2026-10-24',
        ...NINE_HOURS,
        start_time: '07:00',
        end_time: '17:45',
      },
    ]);

    const response = await pay(launch.id, {
      period_start: '2026-10-23',
      period_end: '2026-10-24',
      payment_date: '2026-10-27',
    });

    const [payment] = response.body.data.payments;
    expect(payment).toMatchObject({
      number: 2,
      days: { value_subcents: subcents(424.53125) },
      value_cents: 42453,
      net_cents: 42453,
      deferred_extra_subcents: 0,
    });
    expect(payment.gross_cents - payment.inss_cents).toBe(42453);
    expect(payment.inss_cents).toBe(
      Math.floor((payment.gross_cents * 1100) / 10000),
    );
  });

  it('pagar de novo um periodo ja pago so traz o que ficou pendente', async () => {
    const { launch } = await arrangeLaunch();
    await arrangeWorker(launch);
    await pay(launch.id, FIRST_WEEK);

    const response = await pay(launch.id, FIRST_WEEK, { preview: true });

    const [payment] = response.body.data.payments;
    expect(payment.days).toEqual({
      daily_subcents: 0,
      extra_subcents: subcents(121.875),
      correction_subcents: 0,
      value_subcents: subcents(121.875),
    });
    // Os 7 dias do periodo: o sabado e o domingo de folga acertam o extra
    // com zero, para uma mudanca de ponto neles virar correcao depois.
    expect(payment.lines.map((line) => line.part)).toEqual(
      Array(7).fill('extras'),
    );
  });

  it('com tudo pago, a emissao responde 422 e a previa diz o porque', async () => {
    const { launch } = await arrangeLaunch({
      launch: { first_payment_daily_only: false },
    });
    await arrangeWorker(launch);
    await pay(launch.id, FIRST_WEEK);

    const preview = await pay(launch.id, FIRST_WEEK, { preview: true });
    const issue = await pay(launch.id, FIRST_WEEK);

    expect(preview.body.data).toMatchObject({
      payments: [],
      skipped: [expect.objectContaining({ reason: 'nada a pagar' })],
    });
    expect(issue.status).toBe(422);
    expect(issue.body.message).toBe('Nenhum RPA a emitir no periodo.');
  });

  it('a previa e a emissao dao o mesmo valor, no centavo', async () => {
    const { launch } = await arrangeLaunch();
    const worker = await arrangeWorker(launch);
    const body = {
      ...FIRST_WEEK,
      adjustments: [
        {
          worker_id: worker.id,
          kind: 'bonus',
          amount_cents: 12345,
          reason: 'meta da semana',
        },
      ],
    };

    const preview = await pay(launch.id, body, { preview: true });
    const issued = await pay(launch.id, body);

    const { id, ...issuedPayment } = issued.body.data.payments[0];
    expect(id).toEqual(expect.any(Number));
    expect(issuedPayment).toEqual(preview.body.data.payments[0]);
  });

  it('desconto subtrai, em qualquer pagamento', async () => {
    const { launch } = await arrangeLaunch();
    const worker = await arrangeWorker(launch);
    await pay(launch.id, FIRST_WEEK);
    await pay(launch.id, {
      period_start: '2026-10-20',
      period_end: '2026-10-20',
    });

    const response = await pay(
      launch.id,
      {
        period_start: '2026-10-21',
        period_end: '2026-10-21',
        adjustments: [
          {
            worker_id: worker.id,
            kind: 'deduction',
            amount_cents: 5000,
            reason: 'adiantamento',
          },
        ],
      },
      { preview: true },
    );

    expect(response.body.data.payments[0]).toMatchObject({
      number: 3,
      value_cents: 15438,
      adjustments_cents: -5000,
      net_cents: 10438,
    });
  });

  it('o segundo RPA do mes da mesma pessoa, na mesma empresa, respeita o teto do INSS somado', async () => {
    const { company, launch } = await arrangeLaunch();
    const worker = await arrangeWorker(launch);
    // Outro lancamento da mesma empresa, com a mesma pessoa: a fonte
    // pagadora e a mesma, e o mes acumula.
    const other = await arrangeLaunch({ company });
    const again = await arrangeWorker(other.launch, { number: 1 });
    const bonus = (workerId, amount) => [
      { worker_id: workerId, kind: 'bonus', amount_cents: amount, reason: 'x' },
    ];

    const first = await pay(launch.id, {
      ...FIRST_WEEK,
      adjustments: bonus(worker.id, 540000),
    });
    const second = await pay(other.launch.id, {
      ...FIRST_WEEK,
      payment_date: '2026-10-28',
      adjustments: bonus(again.id, 100000),
    });

    const [a] = first.body.data.payments;
    const [b] = second.body.data.payments;
    expect(b.month_before).toEqual({
      gross_cents: a.gross_cents,
      inss_cents: a.inss_cents,
      irrf_cents: a.irrf_cents,
    });
    // O primeiro fica perto do teto (R$ 8.475,55): o segundo so contribui
    // sobre o que faltava.
    const room = 847555 - a.gross_cents;
    expect(room).toBeGreaterThan(0);
    expect(room).toBeLessThan(b.gross_cents);
    expect(b.inss_cents).toBe(Math.floor((room * 1100) / 10000));
    expect(a.inss_cents + b.inss_cents).toBeLessThanOrEqual(
      Math.floor((847555 * 1100) / 10000),
    );
  });

  it('em outro mes, o acumulado comeca do zero', async () => {
    const { launch } = await arrangeLaunch();
    const worker = await arrangeWorker(launch);
    await pay(launch.id, FIRST_WEEK);

    const response = await pay(
      launch.id,
      {
        period_start: '2026-10-20',
        period_end: '2026-10-20',
        payment_date: '2026-11-03',
      },
      { preview: true },
    );

    expect(response.body.data.payments[0]).toMatchObject({
      worker_id: worker.id,
      code: expect.stringMatching(/-112026$/),
      month_before: { gross_cents: 0, inss_cents: 0, irrf_cents: 0 },
    });
  });
});

describe('POST /api/rpa/launches/:id/payments: codigo repetido', () => {
  it('o codigo que outro lancamento da mesma empresa ja usou no mes deixa a pessoa de fora, sem 500', async () => {
    const { company, launch } = await arrangeLaunch();
    await arrangeWorker(launch, { number: 1 });
    const other = await arrangeLaunch({ company });
    await arrangeWorker(other.launch, { number: 1, cpf: '11144477735' });
    await pay(launch.id, FIRST_WEEK);

    const preview = await pay(other.launch.id, FIRST_WEEK, { preview: true });
    const issue = await pay(other.launch.id, FIRST_WEEK);

    const reason = `o codigo 1-${company.code}-1-102026 ja e de outro RPA valido da empresa`;
    expect(preview.body.data).toMatchObject({
      payments: [],
      skipped: [expect.objectContaining({ reason })],
    });
    expect(issue.status).toBe(422);
    expect(issue.body.details).toEqual([
      { field: 'worker_ids', message: `1: ${reason}` },
    ]);
  });
});

describe('POST /api/rpa/launches/:id/payments: ponto de dia ja pago', () => {
  it('a diferenca entra na previa seguinte como correcao, com o dia', async () => {
    const { launch } = await arrangeLaunch({
      launch: { first_payment_daily_only: false },
    });
    const worker = await arrangeWorker(launch);
    await pay(launch.id, FIRST_WEEK);
    await saveDays(launch.id, [
      { worker_id: worker.id, date: '2026-10-14', quantity: 0 },
    ]);

    const response = await pay(
      launch.id,
      { period_start: '2026-10-20', period_end: '2026-10-21' },
      { preview: true },
    );

    const [payment] = response.body.data.payments;
    expect(payment.lines).toContainEqual({
      date: '2026-10-14',
      part: 'correction',
      value_subcents: -subcents(154.375),
    });
    // Dois dias de 9h menos o dia que virou falta.
    expect(payment.value_cents).toBe(15438);
  });

  it('o RPA emitido nao muda: o detalhe continua com o que saiu', async () => {
    const { launch } = await arrangeLaunch({
      launch: { first_payment_daily_only: false },
    });
    const worker = await arrangeWorker(launch);
    const issued = await pay(launch.id, FIRST_WEEK);
    await saveDays(launch.id, [
      { worker_id: worker.id, date: '2026-10-14', quantity: 0 },
    ]);

    const [payment] = issued.body.data.payments;
    const response = await request('GET', `/api/rpa/payments/${payment.id}`);

    expect(response.body.data).toMatchObject({
      net_cents: payment.net_cents,
      gross_cents: payment.gross_cents,
      status: 'issued',
    });
    expect(response.body.data.lines).toContainEqual({
      date: '2026-10-14',
      part: 'daily',
      value_subcents: subcents(130),
      voided: false,
    });
  });
});

describe('POST /api/rpa/launches/:id/payments: o que nao passa', () => {
  it('dia sem diaria vigente deixa a pessoa de fora, com as datas', async () => {
    const { launch } = await arrangeLaunch();
    await arrangeWorker(launch);

    const response = await pay(
      launch.id,
      { period_start: '2026-11-13', period_end: '2026-11-17' },
      { preview: true },
    );

    expect(response.body.data.skipped).toEqual([
      expect.objectContaining({
        reason: 'sem diaria vigente em 2026-11-16, 2026-11-17',
      }),
    ]);
  });

  it('periodo fora do lancamento, pessoa de outro lancamento e ajuste sem motivo respondem 422', async () => {
    const { launch } = await arrangeLaunch();
    const worker = await arrangeWorker(launch);
    const stranger = await arrangeWorker((await arrangeLaunch()).launch);

    const outside = await pay(launch.id, {
      period_start: '2026-10-01',
      period_end: '2026-10-19',
    });
    const foreign = await pay(launch.id, {
      ...FIRST_WEEK,
      worker_ids: [worker.id, stranger.id],
    });
    const invalid = await pay(launch.id, {
      ...FIRST_WEEK,
      adjustments: [
        { worker_id: worker.id, kind: 'gorjeta', amount_cents: 0, reason: ' ' },
      ],
    });

    expect(outside.body.details).toEqual([
      { field: 'period_start', message: 'fora do periodo do lancamento' },
    ]);
    expect(foreign.body.details).toEqual([
      { field: 'worker_ids[1]', message: 'a pessoa nao e deste lancamento' },
    ]);
    expect(invalid.body.details.map((detail) => detail.field)).toEqual([
      'adjustments[0].kind',
      'adjustments[0].amount_cents',
      'adjustments[0].reason',
    ]);
  });

  it('lancamento encerrado recusa com 409', async () => {
    const { launch } = await arrangeLaunch({ launch: { status: 'closed' } });
    await arrangeWorker(launch);

    const response = await pay(launch.id, FIRST_WEEK);

    expect(response.status).toBe(409);
  });
});

describe('cancelamento e consulta', () => {
  it('o cancelado libera os dias e o numero, e o emitido de novo leva os mesmos', async () => {
    const { launch } = await arrangeLaunch();
    await arrangeWorker(launch);
    const [first] = (await pay(launch.id, FIRST_WEEK)).body.data.payments;

    const canceled = await request(
      'POST',
      `/api/rpa/payments/${first.id}/cancel`,
      { reason: 'data de pagamento errada' },
    );
    const reissued = await pay(launch.id, {
      ...FIRST_WEEK,
      payment_date: '2026-10-21',
    });

    expect(canceled.status).toBe(200);
    expect(canceled.body.data).toMatchObject({
      status: 'canceled',
      cancel_reason: 'data de pagamento errada',
    });
    expect(canceled.body.data.lines.every((line) => line.voided)).toBe(true);
    expect(reissued.body.data.payments[0]).toMatchObject({
      number: 1,
      code: first.code,
      net_cents: 65000,
    });
  });

  it('cancelar de novo, ou sem motivo, nao passa', async () => {
    const { launch } = await arrangeLaunch();
    await arrangeWorker(launch);
    const [payment] = (await pay(launch.id, FIRST_WEEK)).body.data.payments;
    const cancel = (body) =>
      request('POST', `/api/rpa/payments/${payment.id}/cancel`, body);

    const withoutReason = await cancel({ reason: '  ' });
    await cancel({ reason: 'erro' });
    const twice = await cancel({ reason: 'erro' });

    expect(withoutReason.status).toBe(422);
    expect(withoutReason.body.details).toEqual([
      { field: 'reason', message: 'o motivo e obrigatorio' },
    ]);
    expect(twice.status).toBe(409);
  });

  it('o pago nao se cancela', async () => {
    const { launch } = await arrangeLaunch();
    await arrangeWorker(launch);
    const [payment] = (await pay(launch.id, FIRST_WEEK)).body.data.payments;
    // Pago e o recibo assinado (issue 42), que ainda nao tem rota.
    await updateColumnDirectly(
      'rpa_payments',
      payment.id,
      'paid_at',
      '2026-10-22T12:00:00Z',
    );
    await updateColumnDirectly('rpa_payments', payment.id, 'status', 'paid');

    const response = await request(
      'POST',
      `/api/rpa/payments/${payment.id}/cancel`,
      { reason: 'erro' },
    );

    expect(response.status).toBe(409);
  });

  it('lista os pagamentos do lancamento, e filtra pelo numero', async () => {
    const { launch } = await arrangeLaunch();
    await arrangeWorker(launch);
    await arrangeWorker(launch, { number: 8, cpf: '11144477735' });
    await pay(launch.id, FIRST_WEEK);
    await pay(launch.id, {
      period_start: '2026-10-20',
      period_end: '2026-10-20',
    });

    const all = await request('GET', `/api/rpa/launches/${launch.id}/payments`);
    const second = await request(
      'GET',
      `/api/rpa/launches/${launch.id}/payments?number=2`,
    );

    expect(all.body.meta).toEqual({ total: 4, limit: 50, offset: 0 });
    expect(
      all.body.data.map((payment) => [payment.number, payment.worker_number]),
    ).toEqual([
      [1, 7],
      [1, 8],
      [2, 7],
      [2, 8],
    ]);
    expect(second.body.data.map((payment) => payment.number)).toEqual([2, 2]);
    expect(all.body.data[0]).not.toHaveProperty('cpf');
  });

  it('o detalhe traz o que levou de cada dia e os ajustes', async () => {
    const { launch } = await arrangeLaunch();
    const worker = await arrangeWorker(launch);
    const [payment] = (
      await pay(launch.id, {
        ...FIRST_WEEK,
        adjustments: [
          {
            worker_id: worker.id,
            kind: 'addition',
            amount_cents: 2500,
            reason: 'alimentacao extra',
          },
        ],
      })
    ).body.data.payments;

    const response = await request('GET', `/api/rpa/payments/${payment.id}`);

    expect(response.body.data).toMatchObject({
      id: payment.id,
      launch_id: launch.id,
      code: payment.code,
      net_cents: 67500,
      adjustments: [
        { kind: 'addition', amount_cents: 2500, reason: 'alimentacao extra' },
      ],
    });
    expect(response.body.data.lines).toHaveLength(7);
  });
});
