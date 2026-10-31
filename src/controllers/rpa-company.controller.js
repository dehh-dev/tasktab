'use strict';

const Company = require('../models/rpa-company.model');
const { NotFoundError, ValidationError } = require('../../infra/errors');
const validator = require('../validators/rpa-company.validator');

function companyNotFound(id) {
  return new NotFoundError({
    message: `Empresa ${id} nao encontrada.`,
    action: 'Verifique o id informado ou liste as empresas cadastradas.',
  });
}

/** GET /api/rpa/companies */
async function index(req, res) {
  const { limit, offset } = validator.validateListQuery(req.query);
  const [data, total] = await Promise.all([
    Company.findAll({ limit, offset }),
    Company.count(),
  ]);

  res.json({ data, meta: { total, limit, offset } });
}

/** GET /api/rpa/companies/:id — para onde aponta o `Location` do POST. */
async function show(req, res) {
  const id = validator.validateId(req.params.id);
  const company = await Company.findById(id);

  if (!company) {
    throw companyNotFound(id);
  }

  res.json({ data: company });
}

/** POST /api/rpa/companies */
async function create(req, res) {
  const data = validator.validateCreate(req.body);

  // Conferir antes de inserir transforma a violacao de unique — que sairia
  // como 500 — num 422 que diz qual e o problema e onde.
  if (await Company.findByCode(data.code)) {
    throw new ValidationError({
      message: `Ja existe uma empresa com o codigo UAU ${data.code}.`,
      action: 'Atualize a empresa existente em vez de cadastrar de novo.',
      details: [{ field: 'code', message: 'code ja cadastrado' }],
    });
  }

  const company = await Company.create(data);

  res
    .status(201)
    .location(`/api/rpa/companies/${company.id}`)
    .json({ data: company });
}

/** PATCH /api/rpa/companies/:id */
async function update(req, res) {
  const id = validator.validateId(req.params.id);
  const data = validator.validateUpdate(req.body);
  const company = await Company.update(id, data);

  if (!company) {
    throw companyNotFound(id);
  }

  res.json({ data: company });
}

module.exports = { index, show, create, update };
