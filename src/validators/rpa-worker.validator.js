'use strict';

const { BadRequestError, ValidationError } = require('../../infra/errors');
const { isValidIsoDate, parseId, optionalText } = require('./rules');
const cpfRules = require('./cpf');
const pisRules = require('./pis');

const BODY_NOT_OBJECT = {
  message: 'Corpo da requisicao deve ser um objeto JSON.',
  action: 'Envie um objeto com os campos da pessoa.',
};

const INVALID_ID = {
  message: 'id deve ser um inteiro positivo.',
  action: 'Use o id numerico devolvido pela lista da equipe.',
};

const ACCOUNT_TYPES = ['checking', 'savings', 'payment'];
const PIX_KEY_TYPES = ['cpf', 'cnpj', 'email', 'phone', 'random'];
const MAX_DEPENDENTS = 20;

function optionalDate(field) {
  return (value, errors) => {
    if (value === null) return null;

    if (typeof value !== 'string' || !isValidIsoDate(value)) {
      errors.push({
        field,
        message: `${field} deve ser uma data AAAA-MM-DD ou null`,
      });
      return undefined;
    }

    return value;
  };
}

function optionalEnum(field, values) {
  return (value, errors) => {
    if (value === null) return null;

    if (!values.includes(value)) {
      errors.push({
        field,
        message: `${field} deve ser um de: ${values.join(', ')}`,
      });
      return undefined;
    }

    return value;
  };
}

function validateName(value, errors) {
  const name = optionalText('name')(value, errors);

  if (name === null) {
    errors.push({ field: 'name', message: 'name e obrigatorio' });
    return undefined;
  }

  return name;
}

/**
 * O CPF corrigido tem de fechar o verificador: e a chave da pessoa e o que
 * casa o recibo assinado. Na importacao o DV errado entra como pendencia; na
 * correcao, nao.
 */
function validateCpf(value, errors) {
  const cpf = cpfRules.recover(value);

  if (!cpf) {
    errors.push({
      field: 'cpf',
      message: 'cpf deve ter 11 digitos com verificador valido',
    });
    return undefined;
  }

  return cpf.value;
}

function validatePis(value, errors) {
  if (value === null) return null;

  const pis = pisRules.recover(value);

  if (!pis) {
    errors.push({
      field: 'pis',
      message: 'pis deve ter 11 digitos com verificador valido',
    });
    return undefined;
  }

  return pis.value;
}

function validateCep(value, errors) {
  if (value === null) return null;

  const cep = typeof value === 'string' ? value.replace(/\D/g, '') : '';

  if (cep.length !== 8) {
    errors.push({ field: 'cep', message: 'cep deve ter 8 digitos' });
    return undefined;
  }

  return cep;
}

function validateBankCode(value, errors) {
  if (value === null) return null;

  if (typeof value !== 'string' || !/^\d{3}$/.test(value)) {
    errors.push({
      field: 'bank_code',
      message: 'bank_code deve ter 3 digitos',
    });
    return undefined;
  }

  return value;
}

function validateDependents(value, errors) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_DEPENDENTS) {
    errors.push({
      field: 'dependents',
      message: `dependents deve ser um inteiro de 0 a ${MAX_DEPENDENTS}`,
    });
    return undefined;
  }

  return value;
}

const FIELDS = {
  name: validateName,
  cpf: validateCpf,
  role: optionalText('role'),
  starts_on: optionalDate('starts_on'),
  left_on: optionalDate('left_on'),
  promoted_since: optionalDate('promoted_since'),
  dependents: validateDependents,
  email: optionalText('email'),
  rg: optionalText('rg', 20),
  rg_issued_on: optionalDate('rg_issued_on'),
  birth_date: optionalDate('birth_date'),
  birth_place: optionalText('birth_place'),
  pis: validatePis,
  address: optionalText('address'),
  district: optionalText('district'),
  city: optionalText('city'),
  cep: validateCep,
  mother_name: optionalText('mother_name'),
  father_name: optionalText('father_name'),
  bank_code: validateBankCode,
  bank_name: optionalText('bank_name'),
  agency: optionalText('agency', 10),
  bank_operation: optionalText('bank_operation', 10),
  account: optionalText('account', 30),
  account_type: optionalEnum('account_type', ACCOUNT_TYPES),
  pix_key_type: optionalEnum('pix_key_type', PIX_KEY_TYPES),
  pix_key: optionalText('pix_key'),
};

/** `[{ code, field }]`: as pendencias que alguem conferiu e deu por resolvidas. */
function validateResolve(value, errors) {
  const valid =
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every(
      (entry) =>
        entry &&
        typeof entry.code === 'string' &&
        typeof entry.field === 'string',
    );

  if (!valid) {
    errors.push({
      field: 'resolve_issues',
      message: 'resolve_issues deve ser uma lista de { code, field }',
    });
    return undefined;
  }

  return value.map(({ code, field }) => ({ code, field }));
}

/**
 * PATCH da pessoa. Devolve `{ data, resolve }`: os campos que mudam e as
 * pendencias dadas por resolvidas. `launch_id`, `number` e as pendencias em
 * si nao se escrevem por aqui — o numero e fixo e vai no codigo do RPA.
 */
function validateUpdate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError(BODY_NOT_OBJECT);
  }

  const errors = [];
  const data = {};
  let resolve = [];

  for (const [field, validate] of Object.entries(FIELDS)) {
    if (body[field] !== undefined) {
      data[field] = validate(body[field], errors);
    }
  }

  if (body.resolve_issues !== undefined) {
    resolve = validateResolve(body.resolve_issues, errors);
  }

  if (errors.length > 0) {
    throw new ValidationError({ details: errors });
  }

  if (Object.keys(data).length === 0 && resolve.length === 0) {
    throw new ValidationError({
      message: 'Informe ao menos um campo para atualizar.',
      details: [
        {
          field: 'body',
          message: `campos aceitos: ${Object.keys(FIELDS).join(', ')}, resolve_issues`,
        },
      ],
    });
  }

  return { data, resolve };
}

function validateId(rawId) {
  return parseId(rawId, INVALID_ID);
}

module.exports = { validateUpdate, validateId };
