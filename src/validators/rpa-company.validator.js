'use strict';

const { BadRequestError, ValidationError } = require('../../infra/errors');
const {
  isBlank,
  parseId,
  parsePagination,
  validateCnpj,
  optionalText,
  optionalState,
} = require('./rules');

const BODY_NOT_OBJECT = {
  message: 'Corpo da requisicao deve ser um objeto JSON.',
  action: 'Envie um objeto com os campos da empresa.',
};

const INVALID_ID = {
  message: 'id deve ser um inteiro positivo.',
  action: 'Use o id numerico devolvido pela listagem de empresas.',
};

const NAME_MAX_LENGTH = 255;
// Teto do `integer` do Postgres: acima disso o INSERT estouraria com 500.
const CODE_MAX = 2147483647;

const OPTIONAL = {
  city: optionalText('city'),
  state: optionalState('state'),
  service_type: optionalText('service_type'),
  cost_center: optionalText('cost_center', 50),
};

const UPDATABLE = ['name', 'cnpj', ...Object.keys(OPTIONAL)];

function validateCode(value, errors) {
  if (!Number.isInteger(value) || value < 1 || value > CODE_MAX) {
    errors.push({
      field: 'code',
      message: 'code deve ser o codigo UAU, um inteiro positivo',
    });
    return undefined;
  }

  return value;
}

function validateName(value, errors) {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push({ field: 'name', message: 'name e obrigatorio' });
    return undefined;
  }

  const name = value.trim();

  if (name.length > NAME_MAX_LENGTH) {
    errors.push({
      field: 'name',
      message: `name deve ter no maximo ${NAME_MAX_LENGTH} caracteres`,
    });
    return undefined;
  }

  return name;
}

function requiredCnpj(value, errors) {
  if (isBlank(value)) {
    errors.push({ field: 'cnpj', message: 'cnpj e obrigatorio' });
    return undefined;
  }

  return validateCnpj(value, errors);
}

function assertObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError(BODY_NOT_OBJECT);
  }
}

function assertValid(errors) {
  if (errors.length > 0) {
    throw new ValidationError({ details: errors });
  }
}

function validateOptional(body, data, errors) {
  for (const [field, validate] of Object.entries(OPTIONAL)) {
    if (body[field] !== undefined) {
      data[field] = validate(body[field], errors);
    }
  }
}

/**
 * Cadastro da empresa: o codigo UAU, a razao social e o CNPJ sao obrigatorios
 * (sao os tres que a aba EMPRESA sempre trazia). Cidade, UF, tipo de servico
 * e centro de custo podem vir depois — o lancamento herda deles.
 */
function validateCreate(body) {
  assertObject(body);

  const errors = [];
  const data = {};

  if (body.code === undefined || body.code === null) {
    errors.push({ field: 'code', message: 'code e obrigatorio' });
  } else {
    data.code = validateCode(body.code, errors);
  }

  data.name = validateName(body.name, errors);

  data.cnpj = requiredCnpj(body.cnpj, errors);

  validateOptional(body, data, errors);

  assertValid(errors);
  return data;
}

function validateUpdate(body) {
  assertObject(body);

  const errors = [];
  const data = {};

  if (body.name !== undefined) {
    data.name = validateName(body.name, errors);
  }

  if (body.cnpj !== undefined) {
    data.cnpj = requiredCnpj(body.cnpj, errors);
  }

  validateOptional(body, data, errors);

  assertValid(errors);

  if (Object.keys(data).length === 0) {
    throw new ValidationError({
      message: 'Informe ao menos um campo para atualizar.',
      details: [
        {
          field: 'body',
          // O codigo UAU e a identidade da empresa: trocar seria outro
          // cadastro, e mudaria o codigo dos RPAs ja emitidos.
          message: `campos aceitos: ${UPDATABLE.join(', ')}`,
        },
      ],
    });
  }

  return data;
}

function validateId(rawId) {
  return parseId(rawId, INVALID_ID);
}

function validateListQuery(query = {}) {
  const errors = [];
  const result = parsePagination(query, errors);

  assertValid(errors);
  return result;
}

module.exports = {
  validateCreate,
  validateUpdate,
  validateId,
  validateListQuery,
  UPDATABLE,
};
