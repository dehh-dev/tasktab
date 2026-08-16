'use strict';

const Report = require('../models/report.model');
const Receipt = require('../models/receipt.model');
const { NotFoundError } = require('../../infra/errors');
const validator = require('../validators/report.validator');
const validation = require('../services/validation');
const retention = require('../services/retention.service');
const xlsxResumo = require('../services/export/xlsx-resumo.service');
const anexoI = require('../services/export/anexo-i.service');
const pdfConsolidado = require('../services/export/pdf-consolidado.service');

function reportNotFound(id) {
  return new NotFoundError({
    message: `Report ${id} nao encontrado.`,
    action: 'Verifique o id informado ou liste os relatorios disponiveis.',
  });
}

/** GET /api/reports */
async function index(req, res) {
  const { status, limit, offset } = validator.validateListQuery(req.query);
  const [data, total] = await Promise.all([
    Report.findAll({ status, limit, offset }),
    Report.count({ status }),
  ]);

  res.json({ data, meta: { total, limit, offset } });
}

/** GET /api/reports/:id */
async function show(req, res) {
  const id = validator.validateId(req.params.id);
  const report = await Report.findById(id);

  if (!report) {
    throw reportNotFound(id);
  }

  res.json({ data: report });
}

/** POST /api/reports */
async function create(req, res) {
  const data = validator.validateCreate(req.body);
  const report = await Report.create(data);

  res.status(201).location(`/api/reports/${report.id}`).json({ data: report });
}

/** PATCH /api/reports/:id */
async function update(req, res) {
  const id = validator.validateId(req.params.id);

  // O registro atual entra na validacao: o periodo so pode ser conferido em
  // conjunto, e num update parcial metade dele vem do que ja esta gravado.
  const current = await Report.findById(id);

  if (!current) {
    throw reportNotFound(id);
  }

  const data = validator.validateUpdate(req.body, current);
  const report = await Report.update(id, data);

  res.json({ data: report });
}

/** DELETE /api/reports/:id */
async function destroy(req, res) {
  const id = validator.validateId(req.params.id);
  // Levantar os arquivos antes: a cascata da FK leva os comprovantes junto e
  // depois nao ha mais como saber o que estava anexado ao relatorio.
  const files = await Receipt.findFilesByReport(id);
  const deleted = await Report.remove(id);

  if (!deleted) {
    throw reportNotFound(id);
  }

  await retention.discardOrphans(files, req.log);

  res.status(204).send();
}

/** GET /api/reports/:id/validation */
async function validate(req, res) {
  const id = validator.validateId(req.params.id);
  const result = await validation.validateReport(id);

  if (!result) {
    throw reportNotFound(id);
  }

  res.json({ data: result.alerts, meta: result.meta });
}

/** GET /api/reports/:id/export.xlsx */
async function exportXlsx(req, res) {
  const id = validator.validateId(req.params.id);
  const report = await Report.findById(id);

  if (!report) {
    throw reportNotFound(id);
  }

  const receipts = await Receipt.findForExport(id);
  const workbook = await xlsxResumo.buildResumoWorkbook(report, receipts);

  res
    .status(200)
    .set(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    .set('Content-Disposition', `attachment; filename="relatorio-${id}.xlsx"`);

  await workbook.xlsx.write(res);
  res.end();
}

/** GET /api/reports/:id/export/anexo-i.xlsx */
async function exportAnexoI(req, res) {
  const id = validator.validateId(req.params.id);
  const report = await Report.findById(id);

  if (!report) {
    throw reportNotFound(id);
  }

  const receipts = await Receipt.findForExport(id);
  const buffer = await anexoI.fillAnexoI(report, receipts);

  res
    .status(200)
    .set(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    .set('Content-Disposition', `attachment; filename="anexo-i-${id}.xlsx"`)
    .send(buffer);
}

/** GET /api/reports/:id/export.pdf */
async function exportPdf(req, res) {
  const id = validator.validateId(req.params.id);
  const report = await Report.findById(id);

  if (!report) {
    throw reportNotFound(id);
  }

  const receipts = await Receipt.findForExport(id);
  const { bytes } = await pdfConsolidado.buildConsolidatedPdf(report, receipts);

  res
    .status(200)
    .set('Content-Type', 'application/pdf')
    .set('Content-Disposition', `attachment; filename="relatorio-${id}.pdf"`)
    .send(Buffer.from(bytes));
}

module.exports = {
  index,
  show,
  create,
  update,
  destroy,
  validate,
  exportXlsx,
  exportAnexoI,
  exportPdf,
};
