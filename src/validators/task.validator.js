'use strict';

const { BadRequestError, ValidationError } = require('../../infra/errors');
const {
  isBlank,
  isValidIsoDate,
  parseId,
  parsePagination,
} = require('./rules');

const BODY_NOT_OBJECT = {
  message: 'Corpo da requisicao deve ser um objeto JSON.',
  action: 'Envie um objeto com os campos da tarefa.',
};

const INVALID_ID = {
  message: 'id deve ser um inteiro positivo.',
  action: 'Use o id numerico devolvido pela listagem de tarefas.',
};

// `waiting` (issue 74): espera outra pessoa, e nao e a fila de quem faz.
const TASK_STATUSES = ['pending', 'in_progress', 'waiting', 'done'];
const TITLE_MAX_LENGTH = 255;
// "Fatura 62502", "EMP 363", "Processo UAU 164" (issue 74).
const REFERENCE_MAX_LENGTH = 120;

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

/** Texto opcional e curto: vazio ou so espaco e sem valor (null). */
function validateShortText(field, value, errors) {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    errors.push({ field, message: `${field} deve ser uma string ou null` });
    return undefined;
  }
  const text = value.trim();
  if (text.length > REFERENCE_MAX_LENGTH) {
    errors.push({
      field,
      message: `${field} deve ter no maximo ${REFERENCE_MAX_LENGTH} caracteres`,
    });
    return undefined;
  }
  return text === '' ? null : text;
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

  if (body.reference !== undefined) {
    data.reference = validateShortText('reference', body.reference, errors);
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

  if (body.reference !== undefined) {
    data.reference = validateShortText('reference', body.reference, errors);
  }

  assertValid(errors);

  if (Object.keys(data).length === 0) {
    throw new ValidationError({
      message: 'Informe ao menos um campo para atualizar.',
      details: [
        {
          field: 'body',
          message:
            'campos aceitos: title, description, status, due_date, reference',
        },
      ],
    });
  }

  return data;
}

/** Valida o :id da rota, que precisa ser um inteiro positivo. */
function validateId(rawId) {
  return parseId(rawId, INVALID_ID);
}

/** Valida os filtros de listagem (query string). */
function validateListQuery(query = {}) {
  const errors = [];
  const result = { limit: 50, offset: 0 };

  if (query.status !== undefined) {
    result.status = validateStatus(query.status, errors);
  }

  // A busca no titulo e na referencia; vazia e sem filtro.
  if (query.q !== undefined) {
    const q = validateShortText('q', query.q, errors);
    if (q) result.q = q;
  }

  Object.assign(result, parsePagination(query, errors));

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
