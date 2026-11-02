'use strict';

const Launch = require('../models/rpa-launch.model');
const Company = require('../models/rpa-company.model');
const Worker = require('../models/rpa-worker.model');
const RpaFile = require('../models/rpa-file.model');
const { loadLaunch, launchPurged } = require('../services/auth/access.service');
const { importResponses } = require('../services/rpa/import.service');
const retention = require('../services/retention.service');
const { ConflictError, ValidationError } = require('../../infra/errors');
const validator = require('../validators/rpa-launch.validator');

/** GET /api/rpa/launches */
async function index(req, res) {
  const query = validator.validateListQuery(req.query);
  const [data, total] = await Promise.all([
    Launch.findAll(query),
    Launch.count(query),
  ]);

  res.json({
    data,
    meta: { total, limit: query.limit, offset: query.offset },
  });
}

/** GET /api/rpa/launches/:id */
async function show(req, res) {
  const id = validator.validateId(req.params.id);

  res.json({ data: await loadLaunch(id) });
}

/**
 * POST /api/rpa/launches
 *
 * Tipo de servico e centro de custo vem da empresa quando nao sao
 * informados: e o que a aba EMPRESA da planilha fazia, e o RPA precisa dos
 * dois. `created_by` sai da sessao.
 */
async function create(req, res) {
  const data = validator.validateCreate(req.body);
  const company = await Company.findById(data.company_id);

  if (!company) {
    throw new ValidationError({
      message: `Empresa ${data.company_id} nao encontrada.`,
      action: 'Cadastre a empresa ou escolha uma da lista.',
      details: [{ field: 'company_id', message: 'empresa nao encontrada' }],
    });
  }

  // So o campo que nao veio herda: `null` mandado de proposito fica `null`.
  for (const field of ['service_type', 'cost_center']) {
    if (data[field] === undefined) data[field] = company[field];
  }

  const launch = await Launch.create(data, req.user.id);

  res
    .status(201)
    .location(`/api/rpa/launches/${launch.id}`)
    .json({ data: launch });
}

/**
 * PATCH /api/rpa/launches/:id
 *
 * Encerrado, o unico PATCH aceito e o que reabre — como no relatorio.
 */
async function update(req, res) {
  const id = validator.validateId(req.params.id);
  const current = await loadLaunch(id, { write: true, allowClosed: true });
  const data = validator.validateUpdate(req.body, current);
  const reopening = Object.keys(data).length === 1 && data.status === 'open';

  // Sem os dados pessoais, reabrir so serviria para emitir RPA sem conta nem
  // endereco.
  if (current.purged_at) {
    throw launchPurged(current);
  }

  if (current.status === 'closed' && !reopening) {
    throw new ConflictError({
      message: `O lancamento ${id} esta encerrado.`,
      action: 'Reabra o lancamento para altera-lo.',
    });
  }

  res.json({ data: await Launch.update(id, data) });
}

/**
 * DELETE /api/rpa/launches/:id
 *
 * Com RPA emitido (cancelado inclusive) nao se apaga: e o historico do que
 * foi pedido ao financeiro. Os arquivos sao levantados antes, porque a
 * cascata leva as linhas e o disco ficaria com documentos de ninguem.
 */
async function destroy(req, res) {
  const id = validator.validateId(req.params.id);

  await loadLaunch(id, { write: true });

  if ((await Launch.countPayments(id)) > 0) {
    throw new ConflictError({
      message: `O lancamento ${id} tem RPA emitido e nao pode ser apagado.`,
      action: 'Encerre o lancamento em vez de apaga-lo.',
    });
  }

  const files = await RpaFile.findFilesByLaunch(id);

  await Launch.remove(id);
  await retention.discardOrphans(files, req.log);

  res.status(204).send();
}

/** POST /api/rpa/launches/:id/import — o .xlsx ou .csv das respostas. */
async function importTeam(req, res) {
  const id = validator.validateId(req.params.id);
  const launch = await loadLaunch(id, { write: true });

  if (!req.file) {
    throw new ValidationError({
      message: 'Envie a planilha de respostas do formulario.',
      action: 'Anexe o .xlsx ou .csv baixado do Google Forms no campo "file".',
      details: [{ field: 'file', message: 'arquivo obrigatorio' }],
    });
  }

  const result = await importResponses(launch, req.file.buffer);

  // So contagens e ids: o log nunca leva nome, CPF ou conta.
  req.log.info(
    {
      launch_id: id,
      created: result.created,
      updated: result.updated,
      rejected: result.rejected.length,
    },
    'equipe importada',
  );

  res.json({ data: result });
}

/** GET /api/rpa/launches/:id/workers */
async function workers(req, res) {
  const id = validator.validateId(req.params.id);

  await loadLaunch(id);

  res.json({ data: await Worker.findByLaunch(id) });
}

module.exports = { index, show, create, update, destroy, importTeam, workers };
