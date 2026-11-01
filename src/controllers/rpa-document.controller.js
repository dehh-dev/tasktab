'use strict';

const {
  loadLaunch,
  loadPayment,
  launchPurged,
} = require('../services/auth/access.service');
const documents = require('../services/rpa/document.service');
const { contentDisposition } = require('../services/rpa/rpa-format');
const launchValidator = require('../validators/rpa-launch.validator');
const validator = require('../validators/rpa-payment.validator');

/** GET /api/rpa/payments/:id/rpa.pdf */
async function rpaPdf(req, res) {
  const id = validator.validateId(req.params.id);
  const { launch } = await loadPayment(id);

  // O RPA impresso traz conta, endereco e PIS, que a retencao ja apagou.
  if (launch.purged_at) throw launchPurged(launch);

  const { fileName, buffer } = await documents.paymentPdf(id);

  res
    .set('Content-Type', 'application/pdf')
    .set('Content-Disposition', contentDisposition(fileName))
    .send(buffer);
}

/** GET /api/rpa/launches/:id/rpas.zip?payment=n */
async function rpasZip(req, res) {
  const id = launchValidator.validateId(req.params.id);
  const launch = await loadLaunch(id);
  const number = validator.validateDocumentQuery(req.query);

  if (launch.purged_at) throw launchPurged(launch);

  const { fileName, buffer } = await documents.launchZip(launch, number);

  res
    .set('Content-Type', 'application/zip')
    .set('Content-Disposition', contentDisposition(fileName))
    .send(buffer);
}

/** GET /api/rpa/launches/:id/email?payment=n — o texto; o envio e do Gmail. */
async function email(req, res) {
  const id = launchValidator.validateId(req.params.id);
  const launch = await loadLaunch(id);
  const number = validator.validateDocumentQuery(req.query);

  res.json({ data: await documents.launchEmail(launch, number) });
}

module.exports = { rpaPdf, rpasZip, email };
