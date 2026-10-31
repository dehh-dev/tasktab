'use strict';

const { insertRow, insertUser, insertRpaPayment } = require('../orchestrator');
const db = require('../../src/config/database');

/**
 * RPA emitido nunca muda (issue 39, migration `lock-issued-rpa-payments`):
 * conferido direto no banco, porque a trava vale para psql e script tambem.
 * Cada recusa pelo nome da trava, como as constraints do schema.
 */
function violates(constraint) {
  return expect.objectContaining({ constraint });
}

function cancel(paymentId) {
  return db.query(
    `UPDATE rpa_payments
     SET status = 'canceled', canceled_at = now(), cancel_reason = 'erro'
     WHERE id = $1`,
    [paymentId],
  );
}

function paidDay(payment) {
  return insertRow('rpa_payment_days', {
    payment_id: payment.id,
    worker_id: payment.worker_id,
    work_date: '2026-10-19',
    part: 'daily',
    value_subcents: 13000 * 1920,
  });
}

describe('rpa_payments emitido', () => {
  it.each([
    ['net_cents', 70000],
    ['gross_cents', 80000],
    ['period_end', '2026-10-20'],
    ['payment_date', '2026-10-21'],
    ['code', 'outro-codigo'],
    ['number', 2],
    ['dependents', 1],
  ])('%s nao muda', async (column, value) => {
    const payment = await insertRpaPayment();

    await expect(
      db.query(`UPDATE rpa_payments SET ${column} = $2 WHERE id = $1`, [
        payment.id,
        value,
      ]),
    ).rejects.toEqual(violates('rpa_payments_issued_immutable'));
  });

  it('o estado anda: pago e, depois, cancelado', async () => {
    const payment = await insertRpaPayment();

    await db.query(
      `UPDATE rpa_payments SET status = 'paid', paid_at = now() WHERE id = $1`,
      [payment.id],
    );
    await cancel(payment.id);

    const { rows } = await db.query(
      'SELECT status FROM rpa_payments WHERE id = $1',
      [payment.id],
    );
    expect(rows).toEqual([{ status: 'canceled' }]);
  });

  it('o cancelado e final', async () => {
    const payment = await insertRpaPayment();
    await cancel(payment.id);

    await expect(
      db.query(
        `UPDATE rpa_payments
         SET status = 'issued', canceled_at = NULL, cancel_reason = NULL
         WHERE id = $1`,
        [payment.id],
      ),
    ).rejects.toEqual(violates('rpa_payments_canceled_final'));
  });

  it('nao se apaga, nem cancelado', async () => {
    const payment = await insertRpaPayment();
    await cancel(payment.id);

    await expect(
      db.query('DELETE FROM rpa_payments WHERE id = $1', [payment.id]),
    ).rejects.toEqual(violates('rpa_payments_not_deleted'));
  });

  it('apagar quem emitiu nao esbarra na trava: o created_by vira nulo', async () => {
    const user = await insertUser({ email: 'emissor@exemplo.test' });
    const payment = await insertRpaPayment({ created_by: user.id });
    await cancel(payment.id);

    await db.query('DELETE FROM users WHERE id = $1', [user.id]);

    const { rows } = await db.query(
      'SELECT created_by FROM rpa_payments WHERE id = $1',
      [payment.id],
    );
    expect(rows).toEqual([{ created_by: null }]);
  });
});

describe('rpa_payment_days e rpa_payment_adjustments', () => {
  it('o valor do dia pago nao muda nem sai', async () => {
    const payment = await insertRpaPayment();
    await paidDay(payment);

    await expect(
      db.query(
        'UPDATE rpa_payment_days SET value_subcents = 1 WHERE payment_id = $1',
        [payment.id],
      ),
    ).rejects.toEqual(violates('rpa_payment_days_immutable'));
    await expect(
      db.query('DELETE FROM rpa_payment_days WHERE payment_id = $1', [
        payment.id,
      ]),
    ).rejects.toEqual(violates('rpa_payment_days_immutable'));
  });

  it('o dia anulado pelo cancelamento nao volta a valer', async () => {
    const payment = await insertRpaPayment();
    await paidDay(payment);
    await cancel(payment.id);

    await expect(
      db.query(
        'UPDATE rpa_payment_days SET voided = false WHERE payment_id = $1',
        [payment.id],
      ),
    ).rejects.toEqual(violates('rpa_payment_days_immutable'));
  });

  it('acrescimo e desconto nao mudam nem saem', async () => {
    const payment = await insertRpaPayment();
    await insertRow('rpa_payment_adjustments', {
      payment_id: payment.id,
      kind: 'deduction',
      amount_cents: 1000,
      reason: 'adiantamento',
    });

    await expect(
      db.query(
        'UPDATE rpa_payment_adjustments SET amount_cents = 1 WHERE payment_id = $1',
        [payment.id],
      ),
    ).rejects.toEqual(violates('rpa_payment_adjustments_immutable'));
    await expect(
      db.query('DELETE FROM rpa_payment_adjustments WHERE payment_id = $1', [
        payment.id,
      ]),
    ).rejects.toEqual(violates('rpa_payment_adjustments_immutable'));
  });
});
