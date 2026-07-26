'use strict';

const ApiError = require('../errors/api-error');

const TASK_STATUSES = ['pending', 'in_progress', 'done'];
const TITLE_MAX_LENGTH = 255;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

/**
 * Valida uma data no formato ISO 'YYYY-MM-DD' rejeitando valores como
 * '2026-02-31', que o Date() normalizaria silenciosamente.
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

function validateDescription(value, errors) {
  if (value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    errors.push({
      field: 'description',
      message: 'description deve ser uma string ou null',
    });
    return undefined;
  }
  return value.trim();
}

function validateStatus(value, errors) {
  if (typeof value !== 'string' || !TASK_STATUSES.includes(value)) {
    errors.push({
      field: 'status',
      message: `status deve ser um de: ${TASK_STATUSES.join(', ')}`,
    });
    return undefined;
  }
  return value;
}

function validateDueDate(value, errors) {
  if (value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string' || !isValidIsoDate(value)) {
    errors.push({
      field: 'due_date',
      message: 'due_date deve ser uma data valida no formato YYYY-MM-DD',
    });
    return undefined;
  }
  return value;
}

function assertValid(errors) {
  if (errors.length > 0) {
    throw ApiError.unprocessable('Falha de validacao', errors);
  }
}

function validateCreate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw ApiError.badRequest('Corpo da requisicao deve ser um objeto JSON');
  }

  const errors = [];
  const data = {};

  if (isBlank(body.title)) {
    errors.push({ field: 'title', message: 'title e obrigatorio' });
  } else {
    data.title = validateTitle(body.title, errors);
  }

  if (body.description !== undefined) {
    data.description = validateDescription(body.description, errors);
  }

  if (body.status !== undefined) {
    data.status = validateStatus(body.status, errors);
  }

  if (body.due_date !== undefined) {
    data.due_date = validateDueDate(body.due_date, errors);
  }

  assertValid(errors);
  return data;
}

function validateUpdate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw ApiError.badRequest('Corpo da requisicao deve ser um objeto JSON');
  }

  const errors = [];
  const data = {};

  if (body.title !== undefined) {
    data.title = validateTitle(body.title, errors);
  }

  if (body.description !== undefined) {
    data.description = validateDescription(body.description, errors);
  }

  if (body.status !== undefined) {
    data.status = validateStatus(body.status, errors);
  }

  if (body.due_date !== undefined) {
    data.due_date = validateDueDate(body.due_date, errors);
  }

  assertValid(errors);

  if (Object.keys(data).length === 0) {
    throw ApiError.unprocessable('Informe ao menos um campo para atualizar', [
      {
        field: 'body',
        message: 'campos aceitos: title, description, status, due_date',
      },
    ]);
  }

  return data;
}

/** Valida o :id da rota, que precisa ser um inteiro positivo. */
function validateId(rawId) {
  if (!/^\d+$/.test(String(rawId))) {
    throw ApiError.badRequest('id deve ser um inteiro positivo');
  }
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw ApiError.badRequest('id deve ser um inteiro positivo');
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
  TASK_STATUSES,
  TITLE_MAX_LENGTH,
  validateCreate,
  validateUpdate,
  validateId,
  validateListQuery,
};
