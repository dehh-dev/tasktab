'use strict';

const {
  insertRow,
  insertRpaCompany,
  insertRpaLaunch,
  insertRpaWorker,
  insertRpaPayment,
  updateColumnDirectly,
} = require('../orchestrator');
const db = require('../../src/config/database');

/**
 * As garantias do schema do RPA (issue 36), conferidas direto no banco: valem
 * para seed, psql e script, e nao so para a API.
 *
 * Cada recusa e conferida pelo **nome** da constraint. So "rejeita" passaria
 * tambem quando a linha fosse recusada por outro motivo — um NOT NULL
 * esquecido no arranjo, por exemplo.
 */
function violates(constraint) {
  return expect.objectContaining({ constraint });
}

const CANCELED = {
  status: 'canceled',
  canceled_at: new Date(),
  cancel_reason: 'periodo errado',
};

describe('tipos das colunas do RPA', () => {
  it('dinheiro e inteiro e data e date, em todas as tabelas', async () => {
    const { rows } = await db.query(
      `SELECT table_name, column_name, data_type
       FROM information_schema.columns
       WHERE table_name LIKE 'rpa\\_%'
         AND (column_name ~ '_(cents|subcents)$'
              OR column_name ~ '(_on|_date|^period_start|^period_end)$')
       ORDER BY table_name, column_name`,
    );

    const wrong = rows.filter(({ column_name: column, data_type: type }) => {
      if (column.endsWith('_subcents')) return type !== 'bigint';
      if (column.endsWith('_cents')) return type !== 'integer';
      return type !== 'date';
    });

    expect(rows.length).toBeGreaterThan(15);
    expect(wrong).toEqual([]);
  });

  it('nenhuma coluna do RPA usa float', async () => {
    const { rows } = await db.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_name LIKE 'rpa\\_%'
         AND data_type IN ('real', 'double precision', 'money')`,
    );

    expect(rows).toEqual([]);
  });
});

describe('unicos do RPA', () => {
  it('codigo UAU e unico entre as empresas', async () => {
    await insertRpaCompany({ code: 815 });

    await expect(insertRpaCompany({ code: 815 })).rejects.toEqual(
      violates('rpa_companies_code_key'),
    );
  });

  it('o CPF e unico dentro do lancamento, e nao entre lancamentos', async () => {
    const worker = await insertRpaWorker();

    await expect(
      insertRpaWorker({ launch_id: worker.launch_id, number: 2 }),
    ).rejects.toEqual(violates('rpa_workers_unique_cpf_per_launch'));

    await expect(insertRpaWorker()).resolves.toMatchObject({
      cpf: worker.cpf,
    });
  });

  it('o numero da pessoa e unico dentro do lancamento', async () => {
    const worker = await insertRpaWorker();

    await expect(
      insertRpaWorker({ launch_id: worker.launch_id, cpf: '11144477735' }),
    ).rejects.toEqual(violates('rpa_workers_unique_number_per_launch'));
  });

  it('pessoa e dia sao unicos no ponto', async () => {
    const worker = await insertRpaWorker();
    const day = { worker_id: worker.id, work_date: '2026-10-15', quantity: 0 };

    await insertRow('rpa_days', day);

    await expect(insertRow('rpa_days', day)).rejects.toEqual(
      violates('rpa_days_unique_worker_date'),
    );
  });

  it('o codigo do RPA e unico entre os nao cancelados, e cancelar libera', async () => {
    const first = await insertRpaPayment({ code: '1-815-4-102026' });
    const other = await insertRpaWorker();

    await expect(
      insertRpaPayment({ worker_id: other.id, code: '1-815-4-102026' }),
    ).rejects.toEqual(violates('rpa_payments_unique_code_active'));

    await db.query(
      `UPDATE rpa_payments
       SET status = 'canceled', canceled_at = now(), cancel_reason = $2
       WHERE id = $1`,
      [first.id, CANCELED.cancel_reason],
    );

    await expect(
      insertRpaPayment({ worker_id: other.id, code: '1-815-4-102026' }),
    ).resolves.toMatchObject({ code: '1-815-4-102026', status: 'issued' });
  });

  it('o numero do pagamento da pessoa so se repete depois de cancelado', async () => {
    const first = await insertRpaPayment();

    await expect(
      insertRpaPayment({ worker_id: first.worker_id, code: 'outro-codigo' }),
    ).rejects.toEqual(violates('rpa_payments_unique_number_active'));

    await insertRpaPayment({
      worker_id: first.worker_id,
      code: 'cancelado',
      number: 2,
      ...CANCELED,
    });
    await expect(
      insertRpaPayment({
        worker_id: first.worker_id,
        code: 'reemitido',
        number: 2,
      }),
    ).resolves.toMatchObject({ number: 2 });
  });
});

describe('constraints de sanidade do RPA', () => {
  it.each([
    [
      'lancamento',
      async () =>
        insertRpaLaunch({ starts_on: '2026-10-13', ends_on: '2026-10-12' }),
      'rpa_launches_period_in_order',
    ],
    [
      'vigencia da diaria',
      async () =>
        insertRow('rpa_rates', {
          launch_id: (await insertRpaLaunch()).id,
          role: 'Assistente Administrativo',
          starts_on: '2026-10-31',
          ends_on: '2026-10-01',
          daily_cents: 13000,
        }),
      'rpa_rates_period_in_order',
    ],
    [
      'periodo do pagamento',
      async () =>
        insertRpaPayment({
          period_start: '2026-10-20',
          period_end: '2026-10-19',
        }),
      'rpa_payments_period_in_order',
    ],
  ])('fim antes do inicio e recusado: %s', async (_, arrange, constraint) => {
    await expect(arrange()).rejects.toEqual(violates(constraint));
  });

  it('quantidade do dia so pode ser 0, meia ou 1', async () => {
    const worker = await insertRpaWorker();
    const worked = {
      worker_id: worker.id,
      start_time: '08:00',
      end_time: '12:00',
    };

    await expect(
      insertRow('rpa_days', {
        ...worked,
        work_date: '2026-10-14',
        quantity: 0.5,
      }),
    ).resolves.toMatchObject({ quantity: '0.5' });

    await expect(
      insertRow('rpa_days', {
        ...worked,
        work_date: '2026-10-15',
        quantity: 0.75,
      }),
    ).rejects.toEqual(violates('rpa_days_quantity'));
  });

  it('falta nao tem horario, e dia trabalhado tem entrada e saida', async () => {
    const worker = await insertRpaWorker();

    await expect(
      insertRow('rpa_days', {
        worker_id: worker.id,
        work_date: '2026-10-14',
        quantity: 0,
        start_time: '08:00',
        end_time: '17:00',
      }),
    ).rejects.toEqual(violates('rpa_days_times_match_quantity'));

    await expect(
      insertRow('rpa_days', {
        worker_id: worker.id,
        work_date: '2026-10-15',
        quantity: 1,
      }),
    ).rejects.toEqual(violates('rpa_days_times_match_quantity'));
  });

  it.each([
    ['INSS negativo', { inss_cents: -1, gross_cents: 64999 }],
    ['liquido negativo', { net_cents: -1, gross_cents: 8032 }],
  ])('valor negativo no RPA e recusado: %s', async (_, values) => {
    await expect(insertRpaPayment(values)).rejects.toEqual(
      violates('rpa_payments_values_not_negative'),
    );
  });

  it('o bruto tem de fechar com liquido + INSS + IRRF', async () => {
    await expect(insertRpaPayment({ gross_cents: 73034 })).rejects.toEqual(
      violates('rpa_payments_gross_adds_up'),
    );
  });

  it('cancelar exige motivo', async () => {
    const payment = await insertRpaPayment();

    await expect(
      updateColumnDirectly('rpa_payments', payment.id, 'status', 'canceled'),
    ).rejects.toEqual(violates('rpa_payments_cancel_has_reason'));
  });

  it('acrescimo, desconto e bonus sao positivos e tem motivo', async () => {
    const payment = await insertRpaPayment();

    await expect(
      insertRow('rpa_payment_adjustments', {
        payment_id: payment.id,
        kind: 'deduction',
        amount_cents: -1000,
        reason: 'adiantamento',
      }),
    ).rejects.toEqual(violates('rpa_adjustments_positive'));

    await expect(
      insertRow('rpa_payment_adjustments', {
        payment_id: payment.id,
        kind: 'bonus',
        amount_cents: 89375,
        reason: '  ',
      }),
    ).rejects.toEqual(violates('rpa_adjustments_reason'));
  });

  it('diaria zerada e recusada', async () => {
    await expect(
      insertRow('rpa_rates', {
        launch_id: (await insertRpaLaunch()).id,
        role: 'Tecnicos',
        starts_on: '2026-10-01',
        ends_on: '2026-10-31',
        daily_cents: 0,
      }),
    ).rejects.toEqual(violates('rpa_rates_daily_positive'));
  });
});

describe('vigencia da diaria', () => {
  async function rate(launchId, role, startsOn, endsOn) {
    return insertRow('rpa_rates', {
      launch_id: launchId,
      role,
      starts_on: startsOn,
      ends_on: endsOn,
      daily_cents: 13000,
    });
  }

  it('duas vigencias da mesma funcao nao se sobrepoem', async () => {
    const launch = await insertRpaLaunch();
    await rate(
      launch.id,
      'Assistente Administrativo',
      '2026-10-01',
      '2026-10-31',
    );

    // O ultimo dia de uma e o primeiro da outra: o MATCH da planilha pegaria
    // a primeira linha que achasse.
    await expect(
      rate(launch.id, 'Assistente Administrativo', '2026-10-31', '2026-11-30'),
    ).rejects.toEqual(violates('rpa_rates_no_overlap'));
  });

  it('vigencias seguidas, outra funcao e outro lancamento passam', async () => {
    const launch = await insertRpaLaunch();
    const other = await insertRpaLaunch();
    await rate(
      launch.id,
      'Assistente Administrativo',
      '2026-10-01',
      '2026-10-31',
    );

    await expect(
      Promise.all([
        rate(
          launch.id,
          'Assistente Administrativo',
          '2026-11-01',
          '2026-11-30',
        ),
        rate(launch.id, 'Recepcionista', '2026-10-01', '2026-10-31'),
        rate(other.id, 'Assistente Administrativo', '2026-10-01', '2026-10-31'),
      ]),
    ).resolves.toHaveLength(3);
  });
});

describe('dia pago uma vez so', () => {
  function paidDay(payment, overrides = {}) {
    return insertRow('rpa_payment_days', {
      payment_id: payment.id,
      worker_id: payment.worker_id,
      work_date: '2026-10-19',
      part: 'daily',
      value_subcents: 13000 * 1920,
      ...overrides,
    });
  }

  it('a diaria de um dia nao entra em dois pagamentos', async () => {
    const first = await insertRpaPayment();
    const second = await insertRpaPayment({
      worker_id: first.worker_id,
      number: 2,
      code: 'segundo',
    });
    await paidDay(first);

    await expect(paidDay(second)).rejects.toEqual(
      violates('rpa_payment_days_paid_once'),
    );
  });

  it('os extras do dia entram em outro pagamento, separados da diaria', async () => {
    // O caso de hoje: o 1o pagamento leva so a diaria de 19/10, e o extra de
    // R$ 48,75 vai no 2o.
    const first = await insertRpaPayment();
    const second = await insertRpaPayment({
      worker_id: first.worker_id,
      number: 2,
      code: 'segundo',
    });
    await paidDay(first);

    await expect(
      paidDay(second, { part: 'extras', value_subcents: 4875 * 1920 }),
    ).resolves.toMatchObject({ part: 'extras' });
    await expect(
      paidDay(second, { part: 'extras', work_date: '2026-10-19' }),
    ).rejects.toEqual(violates('rpa_payment_days_pkey'));
  });

  it('cancelar o RPA libera os dias que ele levou', async () => {
    const first = await insertRpaPayment();
    await paidDay(first);

    await db.query(
      `UPDATE rpa_payments
       SET status = 'canceled', canceled_at = now(), cancel_reason = 'erro'
       WHERE id = $1`,
      [first.id],
    );

    const reissued = await insertRpaPayment({
      worker_id: first.worker_id,
      code: 'reemitido',
    });

    await expect(paidDay(reissued)).resolves.toMatchObject({ voided: false });

    const { rows } = await db.query(
      'SELECT voided FROM rpa_payment_days WHERE payment_id = $1',
      [first.id],
    );
    expect(rows).toEqual([{ voided: true }]);
  });

  it('a correcao de um dia pago pode ser negativa e se repetir', async () => {
    const first = await insertRpaPayment();
    const second = await insertRpaPayment({
      worker_id: first.worker_id,
      number: 2,
      code: 'segundo',
    });
    const third = await insertRpaPayment({
      worker_id: first.worker_id,
      number: 3,
      code: 'terceiro',
    });
    await paidDay(first);

    await expect(
      Promise.all([
        paidDay(second, { part: 'correction', value_subcents: -2437 * 1920 }),
        paidDay(third, { part: 'correction', value_subcents: 1000 }),
      ]),
    ).resolves.toHaveLength(2);
    await expect(
      paidDay(second, {
        part: 'extras',
        work_date: '2026-10-20',
        value_subcents: -1,
      }),
    ).rejects.toEqual(violates('rpa_payment_days_value_sign'));
  });

  it('o dia levado e da mesma pessoa do pagamento', async () => {
    const payment = await insertRpaPayment();
    const other = await insertRpaWorker();

    await expect(paidDay(payment, { worker_id: other.id })).rejects.toEqual(
      violates('rpa_payment_days_payment_fk'),
    );
  });

  it('pagamento emitido segura o lancamento: apagar e recusado', async () => {
    const payment = await insertRpaPayment();
    const { rows } = await db.query(
      'SELECT launch_id FROM rpa_workers WHERE id = $1',
      [payment.worker_id],
    );

    await expect(
      db.query('DELETE FROM rpa_launches WHERE id = $1', [rows[0].launch_id]),
    ).rejects.toEqual(violates('rpa_payments_worker_id_fkey'));
  });
});

describe('sementes publicas do RPA', () => {
  it('traz os bancos pelo codigo do Banco Central', async () => {
    const { rows } = await db.query(
      `SELECT code, short_name FROM rpa_banks
       WHERE code IN ('001', '033', '104', '260', '323', '341', '479')
       ORDER BY code`,
    );

    // 341 e 479 sao bancos diferentes: a aba BANCOS da planilha dava os dois
    // com o mesmo nome.
    expect(rows).toEqual([
      { code: '001', short_name: 'BCO DO BRASIL S.A.' },
      { code: '033', short_name: 'BCO SANTANDER (BRASIL) S.A.' },
      { code: '104', short_name: 'CAIXA ECONOMICA FEDERAL' },
      { code: '260', short_name: 'NU PAGAMENTOS - IP' },
      { code: '323', short_name: 'MERCADO PAGO IP LTDA.' },
      { code: '341', short_name: 'ITAÚ UNIBANCO S.A.' },
      { code: '479', short_name: 'BCO ITAUBANK S.A.' },
    ]);
  });

  it('traz INSS e IRRF de 2025 e 2026, com a reducao so em 2026', async () => {
    const { rows } = await db.query(
      `SELECT kind, starts_on, inss_rate_bp, inss_ceiling_cents,
              irrf_brackets -> 0 ->> 'up_to_cents' AS exempt_up_to,
              irrf_simplified_discount_cents AS simplified,
              irrf_dependent_deduction_cents AS dependent,
              irrf_reduction ->> 'full_up_to_cents' AS reduction_up_to
       FROM rpa_tax_tables ORDER BY kind, starts_on`,
    );

    expect(rows).toEqual([
      expect.objectContaining({
        kind: 'inss',
        starts_on: '2025-01-01',
        inss_rate_bp: 1100,
        inss_ceiling_cents: 815741,
      }),
      expect.objectContaining({
        kind: 'inss',
        starts_on: '2026-01-01',
        inss_rate_bp: 1100,
        inss_ceiling_cents: 847555,
      }),
      expect.objectContaining({
        kind: 'irrf',
        starts_on: '2024-02-01',
        exempt_up_to: '225920',
        simplified: 56480,
        dependent: 18959,
        reduction_up_to: null,
      }),
      expect.objectContaining({
        kind: 'irrf',
        starts_on: '2025-05-01',
        exempt_up_to: '242880',
        simplified: 60720,
        reduction_up_to: null,
      }),
      expect.objectContaining({
        kind: 'irrf',
        starts_on: '2026-01-01',
        exempt_up_to: '242880',
        simplified: 60720,
        reduction_up_to: '500000',
      }),
    ]);
  });

  it('a tabela do IRRF de 2025 retem R$ 290,15 sobre R$ 4.800,00 sem a reducao', async () => {
    // O caso da issue 39: a mesma conta, feita so com o que esta no banco,
    // prova que as faixas semeadas sao as da Receita. A base e o bruto menos
    // o desconto simplificado da tabela de fev/2024.
    const { rows } = await db.query(
      `SELECT (bracket ->> 'rate_bp')::int AS rate_bp,
              (bracket ->> 'deduction_cents')::int AS deduction_cents,
              t.irrf_simplified_discount_cents AS simplified
       FROM rpa_tax_tables t, jsonb_array_elements(t.irrf_brackets) bracket
       WHERE t.kind = 'irrf' AND t.starts_on = '2024-02-01'
         AND (bracket ->> 'up_to_cents' IS NULL
              OR (bracket ->> 'up_to_cents')::int >= 480000 - t.irrf_simplified_discount_cents)
       ORDER BY (bracket ->> 'up_to_cents')::int NULLS LAST
       LIMIT 1`,
    );
    const { rate_bp: rate, deduction_cents: deduction, simplified } = rows[0];
    const base = 480000 - simplified;

    expect(Math.round((base * rate) / 10000) - deduction).toBe(29015);
  });
});

describe('retencao do lancamento (decisao de 2026-11-01)', () => {
  async function launchRow(id) {
    const { rows } = await db.query(
      'SELECT status, closed_at FROM rpa_launches WHERE id = $1',
      [id],
    );
    return rows[0];
  }

  it('encerrar marca closed_at, inclusive por psql; reabrir limpa', async () => {
    const launch = await insertRpaLaunch();

    await updateColumnDirectly('rpa_launches', launch.id, 'status', 'closed');
    const closed = await launchRow(launch.id);
    await updateColumnDirectly('rpa_launches', launch.id, 'status', 'open');

    expect(closed.closed_at).toEqual(expect.any(Date));
    expect(await launchRow(launch.id)).toEqual({
      status: 'open',
      closed_at: null,
    });
  });

  it('closed_at nao existe sem o lancamento encerrado', async () => {
    const launch = await insertRpaLaunch();

    await expect(
      updateColumnDirectly('rpa_launches', launch.id, 'closed_at', new Date()),
    ).rejects.toEqual(violates('rpa_launches_closed_at_matches_status'));
  });

  it('o lancamento cujos dados a retencao apagou nao reabre', async () => {
    const launch = await insertRpaLaunch({ status: 'closed' });
    await updateColumnDirectly(
      'rpa_launches',
      launch.id,
      'purged_at',
      new Date(),
    );

    await expect(
      updateColumnDirectly('rpa_launches', launch.id, 'status', 'open'),
    ).rejects.toEqual(violates('rpa_launches_purged_stays_closed'));
  });
});
