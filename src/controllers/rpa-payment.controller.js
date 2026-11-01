'use strict';

const Payment = require('../models/rpa-payment.model');
const { loadLaunch, loadPayment } = require('../services/auth/access.service');
const {
  previewPayments,
  issuePayments,
} = require('../services/rpa/payment.service');
const { ConflictError } = require('../../infra/errors');
const launchValidator = require('../validators/rpa-launch.validator');
const validator = require('../validators/rpa-payment.validator');

/** GET /api/rpa/launches/:id/payments?status=&number= */
async function index(req, res) {
  const launchId = launchValidator.validateId(req.params.id);
  const query = validator.validateListQuery(req.query);

  await loadLaunch(launchId);

  const filter = { launchId, ...query };
  const [data, total] = await Promise.all([
    Payment.findByLaunch(filter),
    Payment.count(filter),
  ]);

  res.json({
    data,
    meta: { total, limit: query.limit, offset: query.offset },
  });
}

/**
 * POST /api/rpa/launches/:id/payments — `?preview=true` so calcula.
 *
 * O lancamento vem antes do corpo: id inexistente e 404 e encerrado e 409
 * mesmo com o corpo errado.
 */
async function create(req, res) {
  const launchId = launchValidator.validateId(req.params.id);
  const launch = await loadLaunch(launchId, { write: true });
  const preview = validator.validatePreview(req.query);
  const request = validator.validateCreate(req.body);

  if (preview) {
    const result = await previewPayments(launch, request);
    res.json({ data: { preview: true, ...result } });
    return;
  }

  const result = await issuePayments(launchId, request, req.user.id);

  // So contagens e ids: o RPA leva CPF e valores de terceiros.
  req.log.info(
    {
      launch_id: launchId,
      payment_ids: result.payments.map((payment) => payment.id),
      skipped: result.skipped.length,
    },
    'RPAs emitidos',
  );

  res.status(201).json({ data: { preview: false, ...result } });
}

/** GET /api/rpa/payments/:id */
async function show(req, res) {
  const id = validator.validateId(req.params.id);
  const { payment } = await loadPayment(id);

  res.json({ data: payment });
}

/**
 * POST /api/rpa/payments/:id/cancel — com motivo. Libera os dias (trigger do
 * banco) e o numero, para emitir de novo.
 */
async function cancel(req, res) {
  const id = validator.validateId(req.params.id);
  const { payment } = await loadPayment(id, { write: true });

  if (payment.status === 'canceled') {
    throw new ConflictError({
      message: `O RPA ${payment.code} ja esta cancelado.`,
      action: 'Emita um novo pagamento para o periodo.',
    });
  }

  if (payment.status === 'paid') {
    throw new ConflictError({
      message: `O RPA ${payment.code} ja foi pago e nao se cancela.`,
      action:
        'Acerte a diferenca no proximo pagamento, com acrescimo ou desconto.',
    });
  }

  const { reason } = validator.validateCancel(req.body);
  const canceled = await Payment.cancel(id, reason);

  req.log.info({ payment_id: id }, 'RPA cancelado');

  res.json({ data: canceled });
}

/** GET /api/rpa/summary — o widget do Inicio. */
async function summary(req, res) {
  res.json({ data: await Payment.summary() });
}

module.exports = { index, create, show, cancel, summary };
