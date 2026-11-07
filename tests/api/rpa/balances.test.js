'use strict';

const {
  request,
  insertRow,
  insertRpaLaunch,
  insertRpaWorker,
} = require('../../orchestrator');

/**
 * O saldo pendente de cada pessoa (issue 60): o extra adiado pelo 1o
 * pagamento so com diarias e a correcao de dia ja pago. So existia dentro da
 * previa do pagamento seguinte; sem ele, ninguem via.
 */
const NINE_HOURS = {
  quantity: 1,
  start_time: '08:00',
  lunch_out: '12:00',
  lunch_in: '13:00',
  end_time: '18:00',
};

const subcents = (reais) => Math.round(reais * 100 * 1920);

async function arrangeLaunch({ launch = {}, hours = NINE_HOURS } = {}) {
  const row = await insertRpaLaunch({
    starts_on: '2026-10-13',
    ends_on: '2026-10-30',
    ...launch,
  });

  for (const weekday of [1, 2, 3, 4, 5]) {
    await insertRow('rpa_launch_schedules', {
      launch_id: row.id,
      weekday,
      ...hours,
    });
  }
  await insertRow('rpa_rates', {
    launch_id: row.id,
    role: 'Ajudante',
    starts_on: row.starts_on,
    ends_on: row.ends_on,
    daily_cents: 13000,
  });

  const worker = await insertRpaWorker({
    launch_id: row.id,
    number: 7,
    role: 'Ajudante',
    starts_on: row.starts_on,
  });

  return { launch: row, worker };
}

function pay(launchId, body) {
  return request('POST', `/api/rpa/launches/${launchId}/payments`, body);
}

function balancesOf(launchId) {
  return request('GET', `/api/rpa/launches/${launchId}/balances`);
}

describe('GET /api/rpa/launches/:id/balances', () => {
  it('o 1o pagamento so com diarias como unico: o extra adiado fica no saldo, com o dia', async () => {
    // Um dia so, de 10h: R$ 130,00 de diaria e R$ 48,75 de extra.
    const { launch, worker } = await arrangeLaunch({
      launch: { ends_on: '2026-10-13', first_payment_daily_only: true },
      hours: { ...NINE_HOURS, end_time: '19:00' },
    });
    const issued = await pay(launch.id, {
      period_start: '2026-10-13',
      period_end: '2026-10-13',
      payment_date: '2026-10-14',
    });
    expect(issued.status).toBe(201);

    const response = await balancesOf(launch.id);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      {
        worker_id: worker.id,
        worker_number: 7,
        worker_name: worker.name,
        extra_subcents: subcents(48.75),
        correction_subcents: 0,
        value_cents: 4875,
        lines: [
          {
            date: '2026-10-13',
            part: 'extras',
            value_subcents: subcents(48.75),
          },
        ],
      },
    ]);
  });

  it('dia pago adiantado que vira falta: a correcao fica contra a pessoa', async () => {
    const { launch, worker } = await arrangeLaunch({
      launch: { ends_on: '2026-10-16', first_payment_daily_only: false },
    });
    await pay(launch.id, {
      period_start: '2026-10-13',
      period_end: '2026-10-16',
      payment_date: '2026-10-14',
    });
    const absence = await request(
      'PUT',
      `/api/rpa/launches/${launch.id}/days`,
      {
        days: [{ worker_id: worker.id, date: '2026-10-16', quantity: 0 }],
      },
    );
    expect(absence.status).toBe(200);

    const response = await balancesOf(launch.id);

    // A diaria e 1h a 50%: R$ 154,375, arredondado para longe do zero.
    expect(response.body.data).toEqual([
      expect.objectContaining({
        worker_id: worker.id,
        extra_subcents: 0,
        correction_subcents: -subcents(154.375),
        value_cents: -15438,
        lines: [
          {
            date: '2026-10-16',
            part: 'correction',
            value_subcents: -subcents(154.375),
          },
        ],
      }),
    ]);
  });

  it('o pagamento seguinte leva o saldo, e quem nao teve pagamento nao aparece', async () => {
    const { launch, worker } = await arrangeLaunch({
      launch: { first_payment_daily_only: true },
    });
    await insertRpaWorker({
      launch_id: launch.id,
      number: 8,
      cpf: '11144477735',
      role: 'Ajudante',
      starts_on: '2026-10-27',
    });
    await pay(launch.id, {
      period_start: '2026-10-13',
      period_end: '2026-10-19',
      payment_date: '2026-10-20',
    });

    const pending = await balancesOf(launch.id);

    // Os 5 dias uteis de 9h: 1h a 50% em cada um.
    expect(pending.body.data).toEqual([
      expect.objectContaining({
        worker_id: worker.id,
        extra_subcents: subcents(5 * 24.375),
        value_cents: 12188,
      }),
    ]);

    await pay(launch.id, {
      period_start: '2026-10-20',
      period_end: '2026-10-26',
      payment_date: '2026-10-27',
    });

    expect((await balancesOf(launch.id)).body.data).toEqual([]);
  });

  it('sem RPA valido, nao ha saldo: o cancelado devolve os dias', async () => {
    const { launch } = await arrangeLaunch({
      launch: { first_payment_daily_only: true },
    });
    const [payment] = (
      await pay(launch.id, {
        period_start: '2026-10-13',
        period_end: '2026-10-19',
        payment_date: '2026-10-20',
      })
    ).body.data.payments;
    await request('POST', `/api/rpa/payments/${payment.id}/cancel`, {
      reason: 'periodo errado',
    });

    expect((await balancesOf(launch.id)).body.data).toEqual([]);
  });
});
