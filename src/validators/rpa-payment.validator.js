'use strict';

const { BadRequestError, ValidationError } = require('../../infra/errors');
const { isValidIsoDate, parseId, parsePagination } = require('./rules');

/**
 * Pagamentos do RPA (issue 39). O corpo do POST e o mesmo na previa e na
 * emissao: periodo, data do pagamento, quem entra (todos, sem `worker_ids`) e
 * os acrescimos, bonus e descontos, cada um com motivo.
 */
const KINDS = ['bonus', 'addition', 'deduction'];
const STATUSES = ['issued', 'paid', 'canceled'];
const MAX_LIST = 500;
// R$ 1 milhao num ajuste so: acima disso e digito a mais.
const MAX_AMOUNT_CENTS = 100000000;

const INVALID_ID = {
  message: 'id deve ser um inteiro positivo.',
  action: 'Use o id numerico devolvido pela listagem de pagamentos.',
};

function assertObject(body, action) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError({
      message: 'Corpo da requisicao deve ser um objeto JSON.',
      action,
    });
  }
}

function assertValid(errors) {
  if (errors.length > 0) {
    throw new ValidationError({ details: errors });
  }
}

function requiredDate(field, value, errors) {
  if (typeof value !== 'string' || !isValidIsoDate(value)) {
    errors.push({ field, message: `${field} deve ser uma data AAAA-MM-DD` });
    return undefined;
  }
  return value;
}

function requiredReason(field, value, errors) {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push({ field, message: 'o motivo e obrigatorio' });
    return undefined;
  }
  if (value.trim().length > 255) {
    errors.push({ field, message: 'o motivo tem no maximo 255 caracteres' });
    return undefined;
  }
  return value.trim();
}

function validateWorkerIds(value, errors) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_LIST ||
    value.some((id) => !Number.isInteger(id) || id < 1)
  ) {
    errors.push({
      field: 'worker_ids',
      message: `worker_ids deve ser uma lista de 1 a ${MAX_LIST} ids`,
    });
    return undefined;
  }
  return [...new Set(value)];
}

function validateAdjustments(value, errors) {
  if (!Array.isArray(value) || value.length > MAX_LIST) {
    errors.push({
      field: 'adjustments',
      message: `adjustments deve ser uma lista de ate ${MAX_LIST} ajustes`,
    });
    return [];
  }

  return value.flatMap((adjustment, index) => {
    const at = (name) => `adjustments[${index}].${name}`;

    if (
      !adjustment ||
      typeof adjustment !== 'object' ||
      Array.isArray(adjustment)
    ) {
      errors.push({
        field: `adjustments[${index}]`,
        message: 'ajuste deve ser um objeto',
      });
      return [];
    }

    const before = errors.length;

    if (!Number.isInteger(adjustment.worker_id) || adjustment.worker_id < 1) {
      errors.push({ field: at('worker_id'), message: 'worker_id invalido' });
    }

    if (!KINDS.includes(adjustment.kind)) {
      errors.push({
        field: at('kind'),
        message: 'kind deve ser bonus, addition ou deduction',
      });
    }

    if (
      !Number.isInteger(adjustment.amount_cents) ||
      adjustment.amount_cents < 1 ||
      adjustment.amount_cents > MAX_AMOUNT_CENTS
    ) {
      errors.push({
        field: at('amount_cents'),
        message: 'amount_cents deve ser um inteiro positivo, em centavos',
      });
    }

    const reason = requiredReason(at('reason'), adjustment.reason, errors);

    if (errors.length > before) return [];

    return [
      {
        worker_id: adjustment.worker_id,
        kind: adjustment.kind,
        amount_cents: adjustment.amount_cents,
        reason,
      },
    ];
  });
}

function validateCreate(body) {
  assertObject(
    body,
    'Envie periodo, data do pagamento e, se quiser, as pessoas e os ajustes.',
  );

  const errors = [];
  const data = {
    period_start: requiredDate('period_start', body.period_start, errors),
    period_end: requiredDate('period_end', body.period_end, errors),
    payment_date: requiredDate('payment_date', body.payment_date, errors),
    adjustments: [],
  };

  if (
    data.period_start &&
    data.period_end &&
    data.period_end < data.period_start
  ) {
    errors.push({ field: 'period_end', message: 'fim antes do inicio' });
  }

  if (body.worker_ids !== undefined) {
    data.worker_ids = validateWorkerIds(body.worker_ids, errors);
  }

  if (body.adjustments !== undefined) {
    data.adjustments = validateAdjustments(body.adjustments, errors);
  }

  assertValid(errors);
  return data;
}

/** `?preview=true` faz a previa; sem ele, ou com `false`, emite. */
function validatePreview(query = {}) {
  if (query.preview === undefined || query.preview === 'false') return false;
  if (query.preview === 'true') return true;

  throw new ValidationError({
    details: [{ field: 'preview', message: 'preview deve ser true ou false' }],
  });
}

function validateCancel(body) {
  assertObject(body, 'Envie { "reason": "..." } com o motivo do cancelamento.');

  const errors = [];
  const reason = requiredReason('reason', body.reason, errors);

  assertValid(errors);
  return { reason };
}

function validateListQuery(query = {}) {
  const errors = [];
  const result = parsePagination(query, errors);

  if (query.status !== undefined) {
    if (!STATUSES.includes(query.status)) {
      errors.push({
        field: 'status',
        message: 'status deve ser issued, paid ou canceled',
      });
    } else {
      result.status = query.status;
    }
  }

  if (query.number !== undefined) {
    const number = Number(query.number);
    if (!Number.isInteger(number) || number < 1) {
      errors.push({
        field: 'number',
        message: 'number deve ser o numero do pagamento (1, 2, ...)',
      });
    } else {
      result.number = number;
    }
  }

  assertValid(errors);
  return result;
}

/** `?payment=n`: o numero do pagamento (1o, 2o, ...) do zip e do e-mail. */
function validateDocumentQuery(query = {}) {
  const number = Number(query.payment);

  if (
    query.payment === undefined ||
    !/^\d+$/.test(String(query.payment)) ||
    number < 1
  ) {
    throw new ValidationError({
      message:
        'Informe qual pagamento: ?payment=1 para o 1o, e assim por diante.',
      details: [
        { field: 'payment', message: 'payment deve ser o numero do pagamento' },
      ],
    });
  }

  return number;
}

function validateId(rawId) {
  return parseId(rawId, INVALID_ID);
}

module.exports = {
  validateCreate,
  validatePreview,
  validateCancel,
  validateListQuery,
  validateDocumentQuery,
  validateId,
};
