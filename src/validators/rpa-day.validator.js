'use strict';

const { BadRequestError, ValidationError } = require('../../infra/errors');
const { isValidIsoDate, optionalText } = require('./rules');
const { validateWorkTimes } = require('./rpa-times');

/**
 * A grade do ponto (issue 38). O PUT grava em lote so a excecao: falta, meio
 * periodo, horario diferente. `{ reset: true }` tira a excecao e o dia volta
 * ao horario padrao.
 *
 * O teto do lote cabe no limite de 100 KB do corpo JSON com folga: a equipe
 * de Avare, 30 pessoas, numa semana inteira de excecoes, sao 210 dias.
 */
const MAX_DAYS = 1000;
const QUANTITIES = [0, 0.5, 1];
const TIME_FIELDS = ['start_time', 'lunch_out', 'lunch_in', 'end_time'];

const BODY_NOT_OBJECT = {
  message: 'Corpo da requisicao deve ser um objeto JSON.',
  action: 'Envie { "days": [...] } com os dias que mudam.',
};

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertValid(errors) {
  if (errors.length > 0) {
    throw new ValidationError({ details: errors });
  }
}

function hasTime(day) {
  return TIME_FIELDS.some(
    (field) =>
      day[field] !== undefined && day[field] !== null && day[field] !== '',
  );
}

function validateDay(day, index, seen, errors) {
  const at = (name) => `days[${index}].${name}`;

  if (!isObject(day)) {
    errors.push({ field: `days[${index}]`, message: 'dia deve ser um objeto' });
    return null;
  }

  const before = errors.length;

  if (!Number.isInteger(day.worker_id) || day.worker_id < 1) {
    errors.push({
      field: at('worker_id'),
      message: 'worker_id deve ser o id de uma pessoa do lancamento',
    });
  }

  if (typeof day.date !== 'string' || !isValidIsoDate(day.date)) {
    errors.push({ field: at('date'), message: 'date deve ser AAAA-MM-DD' });
  }

  if (errors.length === before) {
    const key = `${day.worker_id}|${day.date}`;
    if (seen.has(key)) {
      errors.push({ field: at('date'), message: 'dia repetido no lote' });
    }
    seen.add(key);
  }

  // `reset` decide o que o resto do dia significa: com ele errado, conferir
  // horario so somaria erros que nao sao o problema.
  if (day.reset !== undefined) {
    if (day.reset !== true) {
      errors.push({ field: at('reset'), message: 'reset so aceita true' });
      return null;
    }

    return errors.length === before
      ? { index, worker_id: day.worker_id, date: day.date, reset: true }
      : null;
  }

  const quantity = day.quantity ?? 1;
  let times = {
    start_time: null,
    lunch_out: null,
    lunch_in: null,
    end_time: null,
  };

  if (!QUANTITIES.includes(quantity)) {
    errors.push({
      field: at('quantity'),
      message: 'quantity deve ser 0 (falta), 0.5 ou 1',
    });
  } else if (quantity === 0) {
    if (hasTime(day)) {
      errors.push({
        field: at('start_time'),
        message: 'falta nao leva horario',
      });
    }
  } else {
    times = validateWorkTimes(at, day, errors);
  }

  const note =
    day.note === undefined ? null : optionalText(at('note'))(day.note, errors);

  if (errors.length > before) return null;

  return {
    index,
    worker_id: day.worker_id,
    date: day.date,
    quantity,
    ...times,
    note,
  };
}

/** Os dias do PUT, com o `index` de cada um para o erro apontar a linha. */
function validateBatch(body) {
  if (!isObject(body)) {
    throw new BadRequestError(BODY_NOT_OBJECT);
  }

  if (
    !Array.isArray(body.days) ||
    body.days.length === 0 ||
    body.days.length > MAX_DAYS
  ) {
    throw new ValidationError({
      details: [
        {
          field: 'days',
          message: `days deve ser uma lista de 1 a ${MAX_DAYS} dias`,
        },
      ],
    });
  }

  const errors = [];
  const seen = new Set();
  const entries = body.days.map((day, index) =>
    validateDay(day, index, seen, errors),
  );

  assertValid(errors);
  return entries;
}

/** `from` e `to` do GET; o recorte pelo lancamento fica no servico. */
function validateGridQuery(query = {}) {
  const errors = [];
  const result = {};

  for (const field of ['from', 'to']) {
    if (query[field] === undefined) continue;

    if (typeof query[field] !== 'string' || !isValidIsoDate(query[field])) {
      errors.push({ field, message: `${field} deve ser AAAA-MM-DD` });
    } else {
      result[field] = query[field];
    }
  }

  if (result.from && result.to && result.to < result.from) {
    errors.push({ field: 'to', message: 'to antes de from' });
  }

  assertValid(errors);
  return result;
}

module.exports = { MAX_DAYS, validateBatch, validateGridQuery };
