'use strict';

const Report = require('../models/report.model');
const Receipt = require('../models/receipt.model');
const { NotFoundError } = require('../../infra/errors');
const validator = require('../validators/report.validator');
const validation = require('../services/validation');
const ownership = require('../services/auth/ownership');
const retention = require('../services/retention.service');
const xlsxPorTipo = require('../services/export/xlsx-por-tipo.service');
const anexoI = require('../services/export/anexo-i.service');
const pdfConsolidado = require('../services/export/pdf-consolidado.service');

function reportNotFound(id) {
  return new NotFoundError({
    message: `Report ${id} nao encontrado.`,
    action: 'Verifique o id informado ou liste os relatorios disponiveis.',
  });
}

/**
 * Carrega o relatorio ja conferindo a posse.
 *
 * Toda rota de `:id` passa por aqui — inclusive as exportacoes, que levam o
 * relatorio inteiro num arquivo. Um caminho que carregue o relatorio sem esta
 * funcao e um vazamento esperando acontecer, e por isso ela devolve o registro
 * em vez de so validar: usar o retorno e mais comodo que pular a checagem.
 */
async function loadReport(req, id, { write = false } = {}) {
  const report = await Report.findById(id);

  if (!report) {
    throw reportNotFound(id);
  }

  if (write) {
    ownership.assertCanWriteReport(req.user, report);
  } else {
    ownership.assertCanReadReport(req.user, report);
  }

  return report;
}

/** GET /api/reports */
async function index(req, res) {
  const { status, limit, offset } = validator.validateListQuery(req.query);

  // Quem tem `reports:read:any` recebe `undefined` e ve tudo; os demais so
  // veem o que e seu. O filtro vai no SQL, e nao numa varredura depois da
  // consulta: paginar sobre o que ja foi filtrado e o que faz o `meta.total`
  // dizer a verdade.
  const ownerId = ownership.reportOwnerFilter(req.user);

  const [data, total] = await Promise.all([
    Report.findAll({ status, ownerId, limit, offset }),
    Report.count({ status, ownerId }),
  ]);

  res.json({ data, meta: { total, limit, offset } });
}

/** GET /api/reports/:id */
async function show(req, res) {
  const id = validator.validateId(req.params.id);
  const report = await loadReport(req, id);

  res.json({ data: report });
}

/** POST /api/reports */
async function create(req, res) {
  const data = validator.validateCreate(req.body);

  // O dono sai da sessao, nunca do corpo: aceitar `owner_id` do cliente seria
  // deixar qualquer um criar relatorio em nome de outra pessoa.
  const report = await Report.create({ ...data, owner_id: req.user.id });

  res.status(201).location(`/api/reports/${report.id}`).json({ data: report });
}

/** PATCH /api/reports/:id */
async function update(req, res) {
  const id = validator.validateId(req.params.id);

  // O registro atual entra na validacao: o periodo so pode ser conferido em
  // conjunto, e num update parcial metade dele vem do que ja esta gravado.
  const current = await loadReport(req, id, { write: true });

  const data = validator.validateUpdate(req.body, current);
  const report = await Report.update(id, data);

  res.json({ data: report });
}

/** DELETE /api/reports/:id */
async function destroy(req, res) {
  const id = validator.validateId(req.params.id);

  await loadReport(req, id, { write: true });

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

  await loadReport(req, id);

  const result = await validation.validateReport(id);

  if (!result) {
    throw reportNotFound(id);
  }

  res.json({ data: result.alerts, meta: result.meta });
}

/** GET /api/reports/:id/export.xlsx */
async function exportXlsx(req, res) {
  const id = validator.validateId(req.params.id);
  const report = await loadReport(req, id);

  const receipts = await Receipt.findForExport(id);
  const workbook = await xlsxPorTipo.buildWorkbook(report, receipts);

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
  const report = await loadReport(req, id);

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
  const report = await loadReport(req, id);

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
