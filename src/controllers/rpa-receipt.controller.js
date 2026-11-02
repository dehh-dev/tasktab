'use strict';

const {
  loadLaunch,
  loadReceiptBatch,
} = require('../services/auth/access.service');
const {
  startReceipts,
  receiptsZip,
} = require('../services/rpa/receipts.service');
const { contentDisposition } = require('../services/rpa/rpa-format');
const { ValidationError } = require('../../infra/errors');
const launchValidator = require('../validators/rpa-launch.validator');
const paymentValidator = require('../validators/rpa-payment.validator');

/**
 * POST /api/rpa/launches/:id/receipts?payment=n — os recibos assinados: o
 * PDF escaneado com todos, ou um PDF por pessoa, no campo `file`. Responde
 * 202: a leitura segue na fila, e o resultado sai em
 * GET /api/rpa/receipt-batches/:id.
 */
async function create(req, res) {
  const id = launchValidator.validateId(req.params.id);
  const launch = await loadLaunch(id, { write: true });
  const number = paymentValidator.validateDocumentQuery(req.query);

  if (!req.files?.length) {
    throw new ValidationError({
      message: 'Envie o PDF dos recibos assinados.',
      action:
        'Anexe no campo "file" o PDF escaneado com todos, ou um PDF por pessoa.',
      details: [{ field: 'file', message: 'arquivo obrigatorio' }],
    });
  }

  const batch = await startReceipts({
    launch,
    number,
    buffers: req.files.map((file) => file.buffer),
    createdBy: req.user.id,
    log: req.log,
  });

  req.log.info(
    {
      launch_id: id,
      batch_id: batch.id,
      files: req.files.length,
      pages: batch.page_count,
    },
    'recibos enviados',
  );

  res
    .status(202)
    .location(`/api/rpa/receipt-batches/${batch.id}`)
    .json({ data: batch });
}

/** GET /api/rpa/receipt-batches/:id — o andamento e, no fim, o resultado. */
async function show(req, res) {
  const id = launchValidator.validateId(req.params.id);
  const { batch } = await loadReceiptBatch(id);

  res.json({ data: batch });
}

/** GET /api/rpa/launches/:id/receipts.zip?payment=n */
async function zip(req, res) {
  const id = launchValidator.validateId(req.params.id);
  const launch = await loadLaunch(id);
  const number = paymentValidator.validateDocumentQuery(req.query);
  const { fileName, buffer } = await receiptsZip(launch, number);

  res
    .set('Content-Type', 'application/zip')
    .set('Content-Disposition', contentDisposition(fileName))
    .send(buffer);
}

module.exports = { create, show, zip };
