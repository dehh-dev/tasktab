'use strict';

const { BadRequestError } = require('../../infra/errors');
const cnpjRules = require('./cnpj');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

/**
 * Valida uma data no formato ISO 'YYYY-MM-DD' rejeitando valores como
 * '2026-02-31', que o Date() normalizaria silenciosamente para 03/03.
 *
 * Repare que a comparacao e toda em UTC: `new Date('2026-02-31')` na timezone
 * local desloca a data em um dia, o mesmo motivo do type parser do OID 1082.
 */
function isValidIsoDate(value) {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Compara duas datas ISO sem passar por Date. */
function isoDateNotAfter(start, end) {
  return start <= end;
}

/**
 * O `:id` da rota como inteiro positivo, ou 400 com a mensagem do recurso.
 *
 * Eram cinco copias identicas, uma por validator, que so diferiam no texto do
 * erro. O texto continua de cada um; a regra mora aqui.
 */
function parseId(rawId, invalid) {
  if (!/^\d+$/.test(String(rawId))) {
    throw new BadRequestError(invalid);
  }

  const id = Number(rawId);

  if (!Number.isSafeInteger(id) || id < 1) {
    throw new BadRequestError(invalid);
  }

  return id;
}

/**
 * `limit` e `offset` da query string, com os erros empurrados em `errors`.
 * Valores invalidos ficam no padrao (50 e 0) para o resto da validacao seguir.
 */
function parsePagination(query, errors) {
  const result = { limit: 50, offset: 0 };

  if (query.limit !== undefined) {
    const limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      errors.push({
        field: 'limit',
        message: 'limit deve ser um inteiro entre 1 e 100',
      });
    } else {
      result.limit = limit;
    }
  }

  if (query.offset !== undefined) {
    const offset = Number(query.offset);
    if (!Number.isInteger(offset) || offset < 0) {
      errors.push({
        field: 'offset',
        message: 'offset deve ser um inteiro maior ou igual a 0',
      });
    } else {
      result.offset = offset;
    }
  }

  return result;
}

/**
 * CNPJ com ou sem mascara, devolvido nos 14 caracteres, ou o erro no campo
 * `cnpj`. Vale para o cadastro de emitente e para o CNPJ digitado na revisao
 * de um comprovante — a mesma regra, inclusive a do CNPJ alfanumerico.
 */
function validateCnpj(value, errors) {
  const cnpj = cnpjRules.normalize(value);

  if (cnpj === null) {
    errors.push({
      field: 'cnpj',
      message: 'cnpj deve ter 14 caracteres: 12 letras ou digitos e 2 digitos',
    });
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

module.exports = {
  isBlank,
  isValidIsoDate,
  isoDateNotAfter,
  parseId,
  parsePagination,
  validateCnpj,
};
