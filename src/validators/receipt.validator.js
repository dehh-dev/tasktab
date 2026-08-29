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

// `HH:MM` ou `HH:MM:SS`. A coluna e `time`, entao o banco recusaria lixo de
// qualquer jeito — validar aqui e o que devolve 422 com o campo certo em vez
// de um 500 vindo do driver.
const TIME_FORMAT = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

function validateIssuedTime(value, errors) {
  if (value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string' || !TIME_FORMAT.test(value)) {
    errors.push({
      field: 'issued_time',
      message: 'issued_time deve ser uma hora no formato HH:MM ou HH:MM:SS',
    });
    return undefined;
  }

  return value;
}

function validateDocumentRef(value, errors) {
  if (value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string' || value.length > 120) {
    errors.push({
      field: 'document_ref',
      message: 'document_ref deve ser um texto de ate 120 caracteres',
    });
    return undefined;
  }

  return value.trim();
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

  if (body.issued_time !== undefined) {
    data.issued_time = validateIssuedTime(body.issued_time, errors);
  }

  if (body.document_ref !== undefined) {
    data.document_ref = validateDocumentRef(body.document_ref, errors);
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
          message:
            'campos aceitos: issued_at, issued_time, amount_cents, category, document_ref, status',
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

  // Uma pessoa mexeu na categoria, ou assinou embaixo dela ao confirmar: nos
  // dois casos deixou de ser palpite, e o destaque da revisao tem de sumir.
  if ('category' in data || merged.status === 'confirmed') {
    data.category_guessed = false;
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
