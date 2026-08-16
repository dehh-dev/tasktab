'use strict';

const Merchant = require('../models/merchant.model');
const { NotFoundError, ValidationError } = require('../../infra/errors');
const validator = require('../validators/merchant.validator');

function merchantNotFound(id) {
  return new NotFoundError({
    message: `Merchant ${id} nao encontrado.`,
    action: 'Verifique o id informado ou liste os emitentes cadastrados.',
  });
}

/** GET /api/merchants */
async function index(req, res) {
  const [data, total] = await Promise.all([
    Merchant.findAll(),
    Merchant.count(),
  ]);

  res.json({ data, meta: { total } });
}

/** GET /api/merchants/by-cnpj/:cnpj */
async function showByCnpj(req, res) {
  const cnpj = validator.validateCnpjParam(req.params.cnpj);
  const merchant = await Merchant.findByCnpj(cnpj);

  if (!merchant) {
    throw new NotFoundError({
      message: `Nenhum emitente cadastrado com o CNPJ ${cnpj}.`,
      action: 'Cadastre o emitente para que a categoria seja aplicada sozinha.',
    });
  }

  res.json({ data: merchant });
}

/** POST /api/merchants */
async function create(req, res) {
  const data = validator.validateCreate(req.body);
  const existing = await Merchant.findByCnpj(data.cnpj);

  // Conferir antes de inserir transforma a violacao de unique — que sairia
  // como 500 — num 422 que diz qual e o problema e onde.
  if (existing) {
    throw new ValidationError({
      message: `Ja existe um emitente com o CNPJ ${data.cnpj}.`,
      action: 'Atualize o emitente existente em vez de cadastrar de novo.',
      details: [{ field: 'cnpj', message: 'cnpj ja cadastrado' }],
    });
  }

  const merchant = await Merchant.create(data);

  res
    .status(201)
    .location(`/api/merchants/${merchant.id}`)
    .json({ data: merchant });
}

/** PATCH /api/merchants/:id */
async function update(req, res) {
  const id = validator.validateId(req.params.id);
  const data = validator.validateUpdate(req.body);
  const merchant = await Merchant.update(id, data);

  if (!merchant) {
    throw merchantNotFound(id);
  }

  res.json({ data: merchant });
}

module.exports = { index, showByCnpj, create, update };
