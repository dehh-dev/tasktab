'use strict';

const {
  request,
  requestBinary,
  requestUpload,
  refusedFields,
  insertRow,
  insertRpaCompany,
  insertRpaLaunch,
  insertRpaWorker,
  startApiInstance,
  updateColumnDirectly,
} = require('../../orchestrator');
const { extractPdfText } = require('../../helpers/pdf-text');
const {
  formResponse,
  makeFormXlsx,
  syntheticCpf,
} = require('../../fixtures/forms');

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

function pay(launchId, body, { preview = false, baseUrl } = {}) {
  return request(
    'POST',
    `/api/rpa/launches/${launchId}/payments${preview ? '?preview=true' : ''}`,
    { payment_date: '2026-10-20', ...body },
    { baseUrl },
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

describe('POST /api/rpa/launches/:id/payments: o periodo impresso no RPA (issue 58)', () => {
  const periodsOf = (payments) =>
    Object.fromEntries(
      payments.map((payment) => [
        payment.worker_id,
        [payment.period_start, payment.period_end],
      ]),
    );

  it('quem entrou ou saiu no meio sai com os proprios dias, na lista e no PDF', async () => {
    const { launch } = await arrangeLaunch({
      launch: {
        service_type: 'Prestação de Serviços Administrativos',
        cost_center: '71401',
      },
    });
    const entered = await arrangeWorker(launch, { starts_on: '2026-10-15' });
    const left = await arrangeWorker(launch, {
      number: 8,
      cpf: '11144477735',
      left_on: '2026-10-16',
    });

    const response = await pay(launch.id, FIRST_WEEK);

    expect(response.status).toBe(201);
    const { payments } = response.body.data;
    expect(periodsOf(payments)).toEqual({
      [entered.id]: ['2026-10-15', '2026-10-19'],
      [left.id]: ['2026-10-13', '2026-10-16'],
    });
    // O valor nao muda: 3 e 4 diarias de R$ 130,00.
    expect(payments.map((payment) => payment.value_cents).sort()).toEqual([
      39000, 52000,
    ]);

    const listed = await request(
      'GET',
      `/api/rpa/launches/${launch.id}/payments`,
    );
    expect(periodsOf(listed.body.data)).toEqual(periodsOf(payments));

    const pdf = await requestBinary(
      'GET',
      `/api/rpa/payments/${payments.find((p) => p.worker_id === entered.id).id}/rpa.pdf`,
    );
    const [text] = extractPdfText(pdf.buffer);
    expect(text).toContain('15/10/2026 até 19/10/2026');
  });

  it('tres dias trabalhados, pagos dias depois num periodo maior: so os tres dias, sem as faltas', async () => {
    const { launch } = await arrangeLaunch({
      launch: { first_payment_daily_only: false },
    });
    const worker = await arrangeWorker(launch);
    await saveDays(launch.id, [
      { worker_id: worker.id, date: '2026-10-16', quantity: 0 },
      { worker_id: worker.id, date: '2026-10-19', quantity: 0 },
    ]);
    const body = { ...FIRST_WEEK, payment_date: '2026-10-24' };

    const preview = await pay(launch.id, body, { preview: true });
    const issued = await pay(launch.id, body);

    for (const response of [preview, issued]) {
      expect(response.body.data.payments).toEqual([
        expect.objectContaining({
          period_start: '2026-10-13',
          period_end: '2026-10-15',
          // 3 dias de 9h: R$ 130,00 e 1h a 50% (R$ 24,375), arredondado no total.
          value_cents: 46313,
        }),
      ]);
    }
  });

  it('sem diaria no pagamento, os dias que ele paga; so com bonus, o periodo pedido', async () => {
    const { launch } = await arrangeLaunch();
    const worker = await arrangeWorker(launch, { left_on: '2026-10-19' });
    await pay(launch.id, FIRST_WEEK);
    const nextWeek = {
      period_start: '2026-10-20',
      period_end: '2026-10-26',
      payment_date: '2026-10-27',
    };

    // So o extra que o 1o pagamento deixou pendente, de 13/10 a 19/10.
    const extras = await pay(launch.id, nextWeek);

    expect(extras.body.data.payments).toEqual([
      expect.objectContaining({
        period_start: '2026-10-13',
        period_end: '2026-10-19',
        value_cents: 12188,
      }),
    ]);

    const bonus = await pay(launch.id, {
      ...nextWeek,
      payment_date: '2026-10-28',
      adjustments: [
        {
          worker_id: worker.id,
          kind: 'bonus',
          amount_cents: 5000,
          reason: 'Premio de assiduidade',
        },
      ],
    });

    expect(bonus.body.data.payments).toEqual([
      expect.objectContaining({
        period_start: '2026-10-20',
        period_end: '2026-10-26',
        value_cents: 0,
        net_cents: 5000,
      }),
    ]);
  });
});

describe('POST /api/rpa/launches/:id/payments: as pendencias da pessoa (issue 62)', () => {
  // A equipe pela importacao, como no uso real: as pendencias sao as que a
  // limpeza e a verificacao do cadastro marcam.
  async function importTeam(responses) {
    const { launch } = await arrangeLaunch();
    await insertRow('rpa_rates', {
      launch_id: launch.id,
      role: 'Assistente Administrativo',
      starts_on: '2026-10-13',
      ends_on: '2026-11-15',
      daily_cents: 13000,
    });
    const imported = await requestUpload(
      `/api/rpa/launches/${launch.id}/import`,
      [
        {
          buffer: await makeFormXlsx(responses),
          filename: 'Cadastro AVARE (respostas).xlsx',
        },
      ],
      { field: 'file' },
    );
    expect(imported.status).toBe(200);

    const workers = new Map(
      imported.body.data.workers.map((worker) => [worker.number, worker]),
    );
    return { launch, workers };
  }

  const issuesOf = (body) =>
    Object.fromEntries(
      body.data.payments.map((payment) => [
        payment.worker_number,
        payment.issues.map((issue) => [
          issue.code,
          issue.message,
          issue.blocks_payment,
        ]),
      ]),
    );

  it('a previa lista as pendencias abertas com texto, e a emissao com banco ambiguo pede confirmacao', async () => {
    const { launch } = await importTeam([
      formResponse(1, {
        bank_name: 'Banco ItauBank S.A',
        address: 'Rua Sintetica Sem Numero',
      }),
      formResponse(2),
    ]);

    const preview = await pay(launch.id, FIRST_WEEK, { preview: true });

    expect(preview.status).toBe(200);
    expect(issuesOf(preview.body)).toEqual({
      1: [
        ['bank_ambiguous', expect.stringMatching(/ambiguo|ItauBank/i), true],
        ['address_without_number', 'endereco sem numero', false],
      ],
      2: [],
    });

    // Sem a confirmacao, nada sai: nem o RPA de quem nao tem pendencia.
    const refused = await pay(launch.id, FIRST_WEEK);

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({
      name: 'ValidationError',
      status_code: 422,
    });
    expect(refused.body.details).toEqual([
      {
        field: 'accept_issues',
        message: `1: ${preview.body.data.payments[0].issues[0].message}`,
      },
    ]);
    const listed = await request(
      'GET',
      `/api/rpa/launches/${launch.id}/payments`,
    );
    expect(listed.body.data).toEqual([]);

    const issued = await pay(launch.id, { ...FIRST_WEEK, accept_issues: true });

    expect(issued.status).toBe(201);
    expect(issued.body.data.payments).toHaveLength(2);
  });

  it('pendencia dada por resolvida some da previa, e a que so avisa nao pede confirmacao', async () => {
    const { launch, workers } = await importTeam([
      formResponse(1, {
        bank_name: 'Banco ItauBank S.A',
        address: 'Rua Sintetica Sem Numero',
      }),
    ]);
    const resolved = await request(
      'PATCH',
      `/api/rpa/workers/${workers.get(1).id}`,
      { resolve_issues: [{ code: 'bank_ambiguous', field: 'bank_code' }] },
    );
    expect(resolved.status).toBe(200);

    const preview = await pay(launch.id, FIRST_WEEK, { preview: true });

    expect(issuesOf(preview.body)).toEqual({
      1: [['address_without_number', 'endereco sem numero', false]],
    });

    const issued = await pay(launch.id, FIRST_WEEK);

    expect(issued.status).toBe(201);
  });

  it('conta sem digito, CPF ou PIS invalido e campo de pagamento vazio impedem; CPF completado com zero, nao', async () => {
    const { launch } = await importTeam([
      formResponse(1, { account: '12345678901' }),
      formResponse(2, { cpf: '11111111111' }),
      formResponse(3, { pis: '11111111111' }),
      formResponse(4, { agency: '' }),
      formResponse(5, { birth_place: '' }),
      formResponse(6, { cpf: syntheticCpf(6, { leadingZero: true }) }),
    ]);

    const preview = await pay(launch.id, FIRST_WEEK, { preview: true });

    const blocking = Object.fromEntries(
      preview.body.data.payments.map((payment) => [
        payment.worker_number,
        payment.issues
          .filter((issue) => issue.blocks_payment)
          .map((issue) => `${issue.code}:${issue.field}`),
      ]),
    );
    expect(blocking).toEqual({
      1: ['account_without_digit:account'],
      2: ['cpf_invalid:cpf'],
      3: ['pis_invalid:pis'],
      4: ['missing_field:agency'],
      5: [],
      6: [],
    });
    // As duas que nao barram estao la, so avisando.
    expect(
      preview.body.data.payments
        .filter((payment) => payment.worker_number >= 5)
        .map((payment) => payment.issues.map((issue) => issue.code)),
    ).toEqual([['missing_field'], ['cpf_padded']]);
  });
});

describe('POST /api/rpa/launches/:id/payments: o pagamento depois de um bonus (issue 61)', () => {
  const ADVANCED = {
    worker_id: null,
    kind: 'bonus',
    amount_cents: 73938,
    reason: 'dias 20/10, 21/10 e 22/10 adiantados',
  };
  const NEXT_WEEK = {
    period_start: '2026-10-20',
    period_end: '2026-10-26',
    payment_date: '2026-10-27',
  };

  async function arrangeBonus() {
    const { company, launch } = await arrangeLaunch({
      launch: { first_payment_daily_only: false },
    });
    const worker = await arrangeWorker(launch);
    const other = await arrangeWorker(launch, {
      number: 8,
      cpf: '11144477735',
    });
    const first = await pay(launch.id, {
      ...FIRST_WEEK,
      adjustments: [{ ...ADVANCED, worker_id: worker.id }],
    });
    expect(first.status).toBe(201);

    return { company, launch, worker, other, first };
  }

  const warningsOf = (body) =>
    Object.fromEntries(
      body.data.payments.map((payment) => [
        payment.worker_number,
        payment.warnings,
      ]),
    );

  it('a previa seguinte avisa com o RPA, o valor e o motivo do bonus, e deixa a conta como esta', async () => {
    const { company, launch } = await arrangeBonus();

    const preview = await pay(launch.id, NEXT_WEEK, { preview: true });

    expect(preview.status).toBe(200);
    expect(warningsOf(preview.body)).toEqual({
      7: [
        {
          code: 'after_bonus',
          message:
            `o RPA 1-${company.code}-7-102026 levou bonus de R$ 739,38 ` +
            '("dias 20/10, 21/10 e 22/10 adiantados"). Bonus nao cobre dia: ' +
            'confira se este pagamento nao paga de novo os dias que ele adiantou.',
        },
      ],
      8: [],
    });
    // Quem confere decide: os dias continuam na conta.
    const [payment] = preview.body.data.payments;
    expect(payment.days.daily_subcents).toBe(subcents(5 * 130));
  });

  it('so o pagamento logo depois avisa; com o RPA do bonus cancelado, nenhum', async () => {
    const { launch } = await arrangeBonus();
    await pay(launch.id, NEXT_WEEK);

    const after = await pay(
      launch.id,
      {
        period_start: '2026-10-27',
        period_end: '2026-11-02',
        payment_date: '2026-11-03',
      },
      { preview: true },
    );

    expect(warningsOf(after.body)).toEqual({ 7: [], 8: [] });

    const { launch: again, first: bonus } = await arrangeBonus();
    const [bonusPayment] = bonus.body.data.payments.filter(
      (payment) => payment.adjustments.length > 0,
    );
    const canceled = await request(
      'POST',
      `/api/rpa/payments/${bonusPayment.id}/cancel`,
      { reason: 'bonus lancado no lugar dos dias' },
    );
    expect(canceled.status).toBe(200);

    const preview = await pay(again.id, NEXT_WEEK, { preview: true });

    expect(warningsOf(preview.body)).toEqual({ 7: [], 8: [] });
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

  it('cada campo fora do formato responde 422 apontando o campo', async () => {
    const { launch } = await arrangeLaunch();
    const worker = await arrangeWorker(launch);
    const adjustment = {
      worker_id: worker.id,
      kind: 'addition',
      amount_cents: 2500,
      reason: 'alimentacao extra',
    };
    const send = (change) => () => pay(launch.id, { ...FIRST_WEEK, ...change });
    const payments = `/api/rpa/launches/${launch.id}/payments`;

    const refused = await refusedFields({
      'data fora do formato': send({ payment_date: '20/10/2026' }),
      'fim antes do inicio': send({
        period_start: '2026-10-19',
        period_end: '2026-10-13',
      }),
      'worker_ids vazia': send({ worker_ids: [] }),
      'worker_ids com texto': send({ worker_ids: [String(worker.id)] }),
      'adjustments sem lista': send({ adjustments: {} }),
      'ajuste que nao e objeto': send({ adjustments: [1] }),
      'ajuste sem pessoa': send({
        adjustments: [{ ...adjustment, worker_id: 0 }],
      }),
      'ajuste em reais': send({
        adjustments: [{ ...adjustment, amount_cents: 25.5 }],
      }),
      'motivo longo': send({
        adjustments: [{ ...adjustment, reason: 'x'.repeat(256) }],
      }),
      'confirmacao como texto': send({ accept_issues: 'sim' }),
      'previa fora de true ou false': () =>
        request('POST', `${payments}?preview=talvez`, {
          ...FIRST_WEEK,
          payment_date: '2026-10-20',
        }),
      'filtro de status': () => request('GET', `${payments}?status=pago`),
      'filtro de numero': () => request('GET', `${payments}?number=0`),
    });

    expect(refused).toEqual({
      'data fora do formato': ['payment_date'],
      'fim antes do inicio': ['period_end'],
      'worker_ids vazia': ['worker_ids'],
      'worker_ids com texto': ['worker_ids'],
      'adjustments sem lista': ['adjustments'],
      'ajuste que nao e objeto': ['adjustments[0]'],
      'ajuste sem pessoa': ['adjustments[0].worker_id'],
      'ajuste em reais': ['adjustments[0].amount_cents'],
      'motivo longo': ['adjustments[0].reason'],
      'confirmacao como texto': ['accept_issues'],
      'previa fora de true ou false': ['preview'],
      'filtro de status': ['status'],
      'filtro de numero': ['number'],
    });
  });

  it('ajuste de quem nao e do lancamento, ou nao foi escolhido, responde 422 no worker_id', async () => {
    const { launch } = await arrangeLaunch();
    const worker = await arrangeWorker(launch);
    const colleague = await arrangeWorker(launch, {
      number: 8,
      cpf: '11144477735',
    });
    const stranger = await arrangeWorker((await arrangeLaunch()).launch);
    const adjustment = (workerId) => ({
      worker_id: workerId,
      kind: 'addition',
      amount_cents: 2500,
      reason: 'alimentacao extra',
    });

    const response = await pay(launch.id, {
      ...FIRST_WEEK,
      worker_ids: [worker.id],
      adjustments: [adjustment(stranger.id), adjustment(colleague.id)],
    });

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      {
        field: 'adjustments[0].worker_id',
        message: 'a pessoa nao e deste lancamento',
      },
      {
        field: 'adjustments[1].worker_id',
        message: 'a pessoa nao esta entre as escolhidas para o pagamento',
      },
    ]);
  });

  // A primeira tabela de INSS semeada vale de 2025-01-01, e a de IRRF de
  // 2024-02-01: em 2024 ha IRRF e falta o INSS, e faltar uma ja basta.
  it('sem tabela de INSS e IRRF vigente na data do pagamento, previa e emissao respondem 422', async () => {
    const { launch } = await arrangeLaunch();
    await arrangeWorker(launch);
    const body = { ...FIRST_WEEK, payment_date: '2024-06-28' };

    const preview = await pay(launch.id, body, { preview: true });
    const issued = await pay(launch.id, body);

    for (const response of [preview, issued]) {
      expect(response.status).toBe(422);
      expect(response.body.details).toEqual([
        { field: 'payment_date', message: 'sem tabela de imposto' },
      ]);
    }
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

/**
 * A emissao roda numa transacao, que e uma conexao so. Consulta disparada
 * nela com outra em curso o pg 8 enfileira, so com um DeprecationWarning que
 * a instancia principal esconde, e o 9 deixa de aceitar. Esta API sobe com
 * `--throw-deprecation`: o aviso a derruba, e a emissao fica sem resposta.
 */
describe('POST /api/rpa/launches/:id/payments: a transacao, uma consulta por vez', () => {
  let instance = null;

  // Subir um processo novo pode passar do teto padrao de 15 s do Jest quando
  // o disco esta disputado — ver `startApiInstance`.
  beforeAll(async () => {
    instance = await startApiInstance({ NODE_OPTIONS: '--throw-deprecation' });
  }, 70000);

  afterAll(async () => {
    await instance?.stop();
  });

  it('emitir nao dispara consultas em paralelo na conexao da transacao', async () => {
    const { launch } = await arrangeLaunch();
    await arrangeWorker(launch);

    const response = await pay(launch.id, FIRST_WEEK, {
      baseUrl: instance.baseUrl,
    }).catch((error) => {
      throw new Error(`a API caiu na emissao:\n${instance.errors()}`, {
        cause: error,
      });
    });

    expect(response.status).toBe(201);
    expect(response.body.data.payments).toHaveLength(1);
  });
});
