'use strict';

const { BadRequestError, ValidationError } = require('../../infra/errors');
const { isValidIsoDate } = require('./rules');

const BODY_NOT_OBJECT = {
  message: 'Corpo da requisicao deve ser um objeto JSON.',
  action: 'Envie um objeto com os campos do comprovante.',
};

const INVALID_ID = {
  message: 'id deve ser um inteiro positivo.',
  action: 'Use o id numerico devolvido pela listagem de comprovantes.',
};

const EXPENSE_CATEGORIES = [
  'alimentacao',
  'combustivel',
  'estacionamento',
  'lavanderia',
  'transporte',
  'hospedagem',
  'outros',
  'nao_classificado',
];

const RECEIPT_STATUSES = [
  'pending',
  'processing',
  'needs_review',
  'confirmed',
  'duplicate',
  'failed',
];

// Campos que a revisao humana preenche. Corrigir qualquer um deles marca a
// origem como manual — e o que permite a tela destacar o que veio de OCR.
const REVIEWED_FIELDS = ['issued_at', 'amount_cents', 'category'];

function fromEnum(field, allowed) {
  return (value, errors) => {
    if (typeof value !== 'string' || !allowed.includes(value)) {
      errors.push({
        field,
        message: `${field} deve ser um de: ${allowed.join(', ')}`,
      });
      return undefined;
    }
    return value;
  };
}

const validateCategory = fromEnum('category', EXPENSE_CATEGORIES);
const validateStatus = fromEnum('status', RECEIPT_STATUSES);

function validateIssuedAt(value, errors) {
  if (value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string' || !isValidIsoDate(value)) {
    errors.push({
      field: 'issued_at',
      message: 'issued_at deve ser uma data valida no formato YYYY-MM-DD',
    });
    return undefined;
  }

  return value;
}

function validateAmountCents(value, errors) {
  if (value === null) {
    return null;
  }

  if (!Number.isInteger(value) || value < 0) {
    errors.push({
      field: 'amount_cents',
      message:
        'amount_cents deve ser um inteiro de centavos maior ou igual a 0',
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
 * Confirmar significa afirmar que a linha esta pronta para a prestacao de
 * contas. Sem data, valor ou categoria ela nao esta — e deixar passar aqui e
 * o que produz planilha com lacuna descoberta so na conferencia.
 */
function assertConfirmable(merged, errors) {
  for (const field of REVIEWED_FIELDS) {
    if (merged[field] === null || merged[field] === undefined) {
      errors.push({
        field,
        message: `${field} e obrigatorio para confirmar o comprovante`,
      });
    }
  }
}

function validateUpdate(body, current = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError(BODY_NOT_OBJECT);
  }

  const errors = [];
  const data = {};

  if (body.issued_at !== undefined) {
    data.issued_at = validateIssuedAt(body.issued_at, errors);
  }

  if (body.amount_cents !== undefined) {
    data.amount_cents = validateAmountCents(body.amount_cents, errors);
  }

  if (body.category !== undefined) {
    data.category = validateCategory(body.category, errors);
  }

  if (body.status !== undefined) {
    data.status = validateStatus(body.status, errors);
  }

  assertValid(errors);

  if (Object.keys(data).length === 0) {
    throw new ValidationError({
      message: 'Informe ao menos um campo para atualizar.',
      details: [
        {
          field: 'body',
          message: 'campos aceitos: issued_at, amount_cents, category, status',
        },
      ],
    });
  }

  const merged = { ...current, ...data };

  if (merged.status === 'confirmed') {
    assertConfirmable(merged, errors);
    assertValid(errors);
  }

  // Correcao humana marca a origem, para a revisao saber o que ja foi olhado.
  if (REVIEWED_FIELDS.some((field) => field in data)) {
    data.extraction_source = 'manual';
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

function validateListQuery(query = {}) {
  const errors = [];
  const result = {};

  if (query.status !== undefined) {
    result.status = validateStatus(query.status, errors);
  }

  if (query.category !== undefined) {
    result.category = validateCategory(query.category, errors);
  }

  assertValid(errors);
  return result;
}

module.exports = {
  EXPENSE_CATEGORIES,
  RECEIPT_STATUSES,
  validateUpdate,
  validateId,
  validateListQuery,
};
