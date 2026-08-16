'use strict';

const { BadRequestError, ValidationError } = require('../../infra/errors');
const { isBlank, isValidIsoDate, isoDateNotAfter } = require('./rules');

const BODY_NOT_OBJECT = {
  message: 'Corpo da requisicao deve ser um objeto JSON.',
  action: 'Envie um objeto com os campos do relatorio.',
};

const INVALID_ID = {
  message: 'id deve ser um inteiro positivo.',
  action: 'Use o id numerico devolvido pela listagem de relatorios.',
};

const REPORT_STATUSES = ['open', 'closed'];
const TITLE_MAX_LENGTH = 255;

function validateTitle(value, errors) {
  if (typeof value !== 'string') {
    errors.push({ field: 'title', message: 'title deve ser uma string' });
    return undefined;
  }

  const title = value.trim();

  if (title === '') {
    errors.push({ field: 'title', message: 'title e obrigatorio' });
    return undefined;
  }

  if (title.length > TITLE_MAX_LENGTH) {
    errors.push({
      field: 'title',
      message: `title deve ter no maximo ${TITLE_MAX_LENGTH} caracteres`,
    });
    return undefined;
  }

  return title;
}

function validateDate(field, value, errors) {
  if (typeof value !== 'string' || !isValidIsoDate(value)) {
    errors.push({
      field,
      message: `${field} deve ser uma data valida no formato YYYY-MM-DD`,
    });
    return undefined;
  }
  return value;
}

function validateStatus(value, errors) {
  if (typeof value !== 'string' || !REPORT_STATUSES.includes(value)) {
    errors.push({
      field: 'status',
      message: `status deve ser um de: ${REPORT_STATUSES.join(', ')}`,
    });
    return undefined;
  }
  return value;
}

/**
 * Adiantamento entra em **centavos**, sempre inteiro. Aceitar reais aqui
 * abriria a porta para float em dinheiro, que foi o que produziu
 * 219.98000000000002 na conferencia manual que originou este projeto.
 */
function validateAdvanceCents(value, errors) {
  if (!Number.isInteger(value) || value < 0) {
    errors.push({
      field: 'advance_cents',
      message:
        'advance_cents deve ser um inteiro de centavos maior ou igual a 0',
    });
    return undefined;
  }
  return value;
}

function assertValid(errors) {
  if (errors.length > 0) {
    throw new ValidationError({ details: errors });
  }
}

/**
 * O periodo so faz sentido conferido em conjunto. Num update parcial o valor
 * que falta vem do registro atual — sem isso um PATCH de uma data so cairia
 * na constraint do banco e viraria 500 em vez de 422.
 */
function assertPeriodInOrder({ period_start, period_end }, errors) {
  if (!period_start || !period_end) {
    return;
  }

  if (!isoDateNotAfter(period_start, period_end)) {
    errors.push({
      field: 'period_end',
      message: 'period_end deve ser maior ou igual a period_start',
    });
  }
}

function validateCreate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError(BODY_NOT_OBJECT);
  }

  const errors = [];
  const data = {};

  if (isBlank(body.title)) {
    errors.push({ field: 'title', message: 'title e obrigatorio' });
  } else {
    data.title = validateTitle(body.title, errors);
  }

  for (const field of ['period_start', 'period_end']) {
    if (isBlank(body[field])) {
      errors.push({ field, message: `${field} e obrigatorio` });
    } else {
      data[field] = validateDate(field, body[field], errors);
    }
  }

  if (body.advance_cents !== undefined) {
    data.advance_cents = validateAdvanceCents(body.advance_cents, errors);
  }

  if (body.status !== undefined) {
    data.status = validateStatus(body.status, errors);
  }

  assertPeriodInOrder(data, errors);
  assertValid(errors);

  return data;
}

function validateUpdate(body, current = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError(BODY_NOT_OBJECT);
  }

  const errors = [];
  const data = {};

  if (body.title !== undefined) {
    data.title = validateTitle(body.title, errors);
  }

  for (const field of ['period_start', 'period_end']) {
    if (body[field] !== undefined) {
      data[field] = validateDate(field, body[field], errors);
    }
  }

  if (body.advance_cents !== undefined) {
    data.advance_cents = validateAdvanceCents(body.advance_cents, errors);
  }

  if (body.status !== undefined) {
    data.status = validateStatus(body.status, errors);
  }

  assertPeriodInOrder(
    {
      period_start: data.period_start ?? current.period_start,
      period_end: data.period_end ?? current.period_end,
    },
    errors,
  );

  assertValid(errors);

  if (Object.keys(data).length === 0) {
    throw new ValidationError({
      message: 'Informe ao menos um campo para atualizar.',
      details: [
        {
          field: 'body',
          message:
            'campos aceitos: title, period_start, period_end, advance_cents, status',
        },
      ],
    });
  }

  return data;
}

/** Valida o :id da rota, que precisa ser um inteiro positivo. */
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

/** Valida os filtros de listagem (query string). */
function validateListQuery(query = {}) {
  const errors = [];
  const result = { limit: 50, offset: 0 };

  if (query.status !== undefined) {
    result.status = validateStatus(query.status, errors);
  }

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

  assertValid(errors);
  return result;
}

module.exports = {
  REPORT_STATUSES,
  TITLE_MAX_LENGTH,
  validateCreate,
  validateUpdate,
  validateId,
  validateListQuery,
};
