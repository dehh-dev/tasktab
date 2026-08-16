'use strict';

const { BadRequestError, ValidationError } = require('../../infra/errors');
const { isBlank } = require('./rules');
const cnpjRules = require('./cnpj');
const { EXPENSE_CATEGORIES } = require('./receipt.validator');

const BODY_NOT_OBJECT = {
  message: 'Corpo da requisicao deve ser um objeto JSON.',
  action: 'Envie um objeto com os campos do emitente.',
};

const INVALID_ID = {
  message: 'id deve ser um inteiro positivo.',
  action: 'Use o id numerico devolvido pela listagem de emitentes.',
};

const NAME_MAX_LENGTH = 255;

function validateCnpj(value, errors) {
  const cnpj = cnpjRules.normalize(value);

  if (cnpj === null) {
    errors.push({ field: 'cnpj', message: 'cnpj deve ter 14 digitos' });
    return undefined;
  }

  if (!cnpjRules.isValid(cnpj)) {
    errors.push({
      field: 'cnpj',
      message: 'cnpj tem digito verificador invalido',
    });
    return undefined;
  }

  return cnpj;
}

function validateName(value, errors) {
  if (typeof value !== 'string') {
    errors.push({ field: 'name', message: 'name deve ser uma string' });
    return undefined;
  }

  const name = value.trim();

  if (name === '') {
    errors.push({ field: 'name', message: 'name e obrigatorio' });
    return undefined;
  }

  if (name.length > NAME_MAX_LENGTH) {
    errors.push({
      field: 'name',
      message: `name deve ter no maximo ${NAME_MAX_LENGTH} caracteres`,
    });
    return undefined;
  }

  return name;
}

function validateCategory(value, errors) {
  if (typeof value !== 'string' || !EXPENSE_CATEGORIES.includes(value)) {
    errors.push({
      field: 'default_category',
      message: `default_category deve ser um de: ${EXPENSE_CATEGORIES.join(', ')}`,
    });
    return undefined;
  }

  return value;
}

function validateCity(value, errors) {
  if (value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    errors.push({ field: 'city', message: 'city deve ser uma string ou null' });
    return undefined;
  }

  return value.trim();
}

function assertValid(errors) {
  if (errors.length > 0) {
    throw new ValidationError({ details: errors });
  }
}

function validateCreate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError(BODY_NOT_OBJECT);
  }

  const errors = [];
  const data = {};

  if (isBlank(body.cnpj)) {
    errors.push({ field: 'cnpj', message: 'cnpj e obrigatorio' });
  } else {
    data.cnpj = validateCnpj(body.cnpj, errors);
  }

  if (isBlank(body.name)) {
    errors.push({ field: 'name', message: 'name e obrigatorio' });
  } else {
    data.name = validateName(body.name, errors);
  }

  if (body.default_category !== undefined) {
    data.default_category = validateCategory(body.default_category, errors);
  }

  if (body.city !== undefined) {
    data.city = validateCity(body.city, errors);
  }

  assertValid(errors);
  return data;
}

function validateUpdate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError(BODY_NOT_OBJECT);
  }

  const errors = [];
  const data = {};

  if (body.name !== undefined) {
    data.name = validateName(body.name, errors);
  }

  if (body.default_category !== undefined) {
    data.default_category = validateCategory(body.default_category, errors);
  }

  if (body.city !== undefined) {
    data.city = validateCity(body.city, errors);
  }

  assertValid(errors);

  if (Object.keys(data).length === 0) {
    throw new ValidationError({
      message: 'Informe ao menos um campo para atualizar.',
      details: [
        {
          field: 'body',
          // O CNPJ e a identidade do emitente: trocar seria outro cadastro.
          message: 'campos aceitos: name, default_category, city',
        },
      ],
    });
  }

  return data;
}

function validateId(rawId) {
  if (!/^\d+$/.test(String(rawId))) {
    throw new BadRequestError(INVALID_ID);
  }

  const id = Number(rawId);

  if (!Number.isSafeInteger(id) || id < 1) {
    throw new BadRequestError(INVALID_ID);
  }

  return id;
}

/** Valida o CNPJ vindo da rota, devolvendo-o sem mascara. */
function validateCnpjParam(raw) {
  const errors = [];
  const cnpj = validateCnpj(raw, errors);

  if (errors.length > 0) {
    throw new BadRequestError({
      message: 'cnpj invalido.',
      action: 'Informe um CNPJ de 14 digitos com verificador valido.',
    });
  }

  return cnpj;
}

module.exports = {
  NAME_MAX_LENGTH,
  validateCreate,
  validateUpdate,
  validateId,
  validateCnpjParam,
};
