'use strict';

const {
  request,
  insertRpaLaunch,
  insertRpaWorker,
  insertRpaPayment,
} = require('../../orchestrator');
const { syntheticCpf } = require('../../fixtures/forms');

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
    });
  });
});
