'use strict';

const {
  request,
  insertRow,
  insertRpaLaunch,
  insertRpaWorker,
  insertRpaPayment,
} = require('../../orchestrator');
const { syntheticCpf } = require('../../fixtures/forms');

const NO_BALANCE = {
  launches: 0,
  to_pay: { people: 0, cents: 0 },
  to_deduct: { people: 0, cents: 0 },
};

/** "Hoje" em Brasilia, mais `days`, como YYYY-MM-DD. */
function brasiliaDay(days = 0) {
  const ms = Date.now() - 3 * 60 * 60 * 1000 + days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

describe('GET /api/rpa/summary', () => {
  it('traz o proximo pagamento, o que espera recibo e quem ainda nao teve RPA', async () => {
    const launch = await insertRpaLaunch({
      starts_on: brasiliaDay(-30),
      ends_on: brasiliaDay(30),
    });
    const worker = (number) =>
      insertRpaWorker({
        launch_id: launch.id,
        number,
        cpf: syntheticCpf(number * 13),
        starts_on: brasiliaDay(-30),
      });
    const [a, b, c, d] = [
      await worker(1),
      await worker(2),
      await worker(3),
      await worker(4),
    ];
    // Dois no proximo pagamento, um que passou sem recibo, um sem RPA.
    await insertRpaPayment({
      worker_id: a.id,
      code: 'a',
      payment_date: brasiliaDay(2),
      net_cents: 65000,
      gross_cents: 73033,
    });
    await insertRpaPayment({
      worker_id: b.id,
      code: 'b',
      payment_date: brasiliaDay(2),
      net_cents: 65000,
      gross_cents: 73033,
    });
    await insertRpaPayment({
      worker_id: c.id,
      code: 'c',
      payment_date: brasiliaDay(-1),
    });
    // Lancamento encerrado nao conta.
    const closed = await insertRpaLaunch({ status: 'closed' });
    await insertRpaWorker({ launch_id: closed.id });

    const response = await request('GET', '/api/rpa/summary');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      open_launches: 1,
      next_payment: {
        payment_date: brasiliaDay(2),
        people: 2,
        net_cents: 130000,
      },
      awaiting_receipt: 1,
      without_payment: 1,
      // RPA sem dia pago no livro nao deixa saldo.
      pending_balance: NO_BALANCE,
    });
    expect(d.id).toBeGreaterThan(0);
  });

  it('sem nada, os numeros sao zero e nao ha proximo pagamento', async () => {
    const response = await request('GET', '/api/rpa/summary');

    expect(response.body.data).toEqual({
      open_launches: 0,
      next_payment: null,
      awaiting_receipt: 0,
      without_payment: 0,
      pending_balance: NO_BALANCE,
    });
  });

  it('soma o saldo pendente dos lancamentos abertos: a pagar e a descontar, por pessoa', async () => {
    // Um dia so, de 10h, pago so com a diaria: R$ 48,75 de extra adiado.
    const owed = async (number, { close = false } = {}) => {
      const launch = await insertRpaLaunch({
        starts_on: '2026-10-13',
        ends_on: '2026-10-13',
        first_payment_daily_only: true,
      });
      await insertRow('rpa_launch_schedules', {
        launch_id: launch.id,
        weekday: 2,
        quantity: 1,
        start_time: '08:00',
        lunch_out: '12:00',
        lunch_in: '13:00',
        end_time: '19:00',
      });
      await insertRow('rpa_rates', {
        launch_id: launch.id,
        role: 'Ajudante',
        starts_on: '2026-10-13',
        ends_on: '2026-10-13',
        daily_cents: 13000,
      });
      const worker = await insertRpaWorker({
        launch_id: launch.id,
        number,
        cpf: syntheticCpf(number),
        role: 'Ajudante',
      });
      const paid = await request(
        'POST',
        `/api/rpa/launches/${launch.id}/payments`,
        {
          period_start: '2026-10-13',
          period_end: '2026-10-13',
          payment_date: '2026-10-14',
        },
      );
      expect(paid.status).toBe(201);
      if (close) {
        await request('PATCH', `/api/rpa/launches/${launch.id}`, {
          status: 'closed',
        });
      }
      return { launch, worker };
    };

    await owed(1);
    await owed(2);
    // Encerrado nao conta, mesmo com saldo.
    await owed(3, { close: true });
    // A falta no dia ja pago passa do extra: o saldo fica contra a pessoa.
    const { launch, worker } = await owed(4);
    await request('PUT', `/api/rpa/launches/${launch.id}/days`, {
      days: [{ worker_id: worker.id, date: '2026-10-13', quantity: 0 }],
    });

    const response = await request('GET', '/api/rpa/summary');

    expect(response.body.data.pending_balance).toEqual({
      launches: 3,
      to_pay: { people: 2, cents: 2 * 4875 },
      to_deduct: { people: 1, cents: 13000 },
    });
  });
});
