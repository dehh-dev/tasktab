'use strict';

const { BadRequestError, ValidationError } = require('../../infra/errors');
const {
  isBlank,
  isValidIsoDate,
  parseId,
  parsePagination,
  optionalText,
  optionalState,
} = require('./rules');
const { fold } = require('../services/rpa/text');

const BODY_NOT_OBJECT = {
  message: 'Corpo da requisicao deve ser um objeto JSON.',
  action: 'Envie um objeto com os campos do lancamento.',
};

const INVALID_ID = {
  message: 'id deve ser um inteiro positivo.',
  action: 'Use o id numerico devolvido pela listagem de lancamentos.',
};

const STATUSES = ['open', 'closed'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAILS = 20;
const MAX_RATES = 50;
// R$ 1 milhao de diaria: acima disso e digito a mais, nao diaria.
const MAX_DAILY_CENTS = 100000000;

const OPTIONAL = {
  service_type: optionalText('service_type'),
  cost_center: optionalText('cost_center', 50),
  site: optionalText('site'),
  product: optionalText('product'),
  supply: optionalText('supply'),
};

function requiredText(field, value, errors) {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push({ field, message: `${field} e obrigatorio` });
    return undefined;
  }

  if (value.trim().length > 255) {
    errors.push({
      field,
      message: `${field} deve ter no maximo 255 caracteres`,
    });
    return undefined;
  }

  return value.trim();
}

function requiredDate(field, value, errors) {
  if (typeof value !== 'string' || !isValidIsoDate(value)) {
    errors.push({ field, message: `${field} deve ser uma data AAAA-MM-DD` });
    return undefined;
  }

  return value;
}

function requiredState(value, errors) {
  if (isBlank(value)) {
    errors.push({ field: 'state', message: 'state e obrigatorio' });
    return undefined;
  }

  return optionalState('state')(value, errors);
}

function validateHolidays(value, errors) {
  if (!Array.isArray(value)) {
    errors.push({
      field: 'holidays',
      message: 'holidays deve ser uma lista de datas',
    });
    return undefined;
  }

  const invalid = value.filter(
    (date) => typeof date !== 'string' || !isValidIsoDate(date),
  );

  if (invalid.length > 0) {
    errors.push({
      field: 'holidays',
      message: 'cada feriado deve ser uma data AAAA-MM-DD',
    });
    return undefined;
  }

  return [...new Set(value)].sort();
}

function validateEmails(field, value, errors) {
  if (!Array.isArray(value) || value.length > MAX_EMAILS) {
    errors.push({
      field,
      message: `${field} deve ser uma lista de ate ${MAX_EMAILS} e-mails`,
    });
    return undefined;
  }

  const emails = value.map((email) =>
    typeof email === 'string' ? email.trim().toLowerCase() : '',
  );

  if (emails.some((email) => !EMAIL.test(email))) {
    errors.push({ field, message: `${field} tem e-mail invalido` });
    return undefined;
  }

  return [...new Set(emails)];
}

function optionalTime(field, value, errors) {
  if (value === undefined || value === null || value === '') return null;

  if (typeof value !== 'string' || !TIME.test(value)) {
    errors.push({ field, message: `${field} deve ser um horario HH:MM` });
    return undefined;
  }

  return value;
}

/**
 * O horario padrao por dia da semana (ISO: 1 = segunda, 7 = domingo). Dia
 * que nao vem e folga. A grade do ponto (issue 38) nasce daqui.
 */
function validateSchedule(value, errors) {
  if (!Array.isArray(value) || value.length > 7) {
    errors.push({
      field: 'schedule',
      message: 'schedule deve ser uma lista de ate 7 dias da semana',
    });
    return undefined;
  }

  const seen = new Set();
  const days = [];

  value.forEach((day, index) => {
    const at = (name) => `schedule[${index}].${name}`;

    if (!day || typeof day !== 'object' || Array.isArray(day)) {
      errors.push({
        field: `schedule[${index}]`,
        message: 'dia deve ser um objeto',
      });
      return;
    }

    const before = errors.length;

    if (!Number.isInteger(day.weekday) || day.weekday < 1 || day.weekday > 7) {
      errors.push({
        field: at('weekday'),
        message: 'weekday deve ser de 1 (segunda) a 7 (domingo)',
      });
    } else if (seen.has(day.weekday)) {
      errors.push({ field: at('weekday'), message: 'dia da semana repetido' });
    }

    const quantity = day.quantity ?? 1;
    if (quantity !== 1 && quantity !== 0.5) {
      errors.push({
        field: at('quantity'),
        message: 'quantity deve ser 1 ou 0.5',
      });
    }

    const start = optionalTime(at('start_time'), day.start_time, errors);
    const end = optionalTime(at('end_time'), day.end_time, errors);
    const lunchOut = optionalTime(at('lunch_out'), day.lunch_out, errors);
    const lunchIn = optionalTime(at('lunch_in'), day.lunch_in, errors);

    if (start === null || end === null) {
      errors.push({
        field: at(start === null ? 'start_time' : 'end_time'),
        message: 'entrada e saida sao obrigatorias',
      });
    }

    if ((lunchOut === null) !== (lunchIn === null)) {
      errors.push({
        field: at('lunch_out'),
        message: 'saida e retorno do almoco vao juntos',
      });
    }

    if (errors.length === before) {
      seen.add(day.weekday);
      days.push({
        weekday: day.weekday,
        quantity,
        start_time: start,
        lunch_out: lunchOut,
        lunch_in: lunchIn,
        end_time: end,
      });
    }
  });

  return days.sort((a, b) => a.weekday - b.weekday);
}

/**
 * A tabela de diarias por funcao, com vigencia. Duas vigencias da mesma
 * funcao (sem acento nem caixa) nao se sobrepoem: o banco tambem recusa,
 * mas aqui o erro aponta as duas linhas em vez de virar 500.
 */
function validateRates(value, errors) {
  if (!Array.isArray(value) || value.length > MAX_RATES) {
    errors.push({
      field: 'rates',
      message: `rates deve ser uma lista de ate ${MAX_RATES} diarias`,
    });
    return undefined;
  }

  const rates = [];

  value.forEach((rate, index) => {
    const at = (name) => `rates[${index}].${name}`;

    if (!rate || typeof rate !== 'object' || Array.isArray(rate)) {
      errors.push({
        field: `rates[${index}]`,
        message: 'diaria deve ser um objeto',
      });
      return;
    }

    const before = errors.length;
    const role = requiredText(at('role'), rate.role, errors);
    const startsOn = requiredDate(at('starts_on'), rate.starts_on, errors);
    const endsOn = requiredDate(at('ends_on'), rate.ends_on, errors);

    if (startsOn && endsOn && endsOn < startsOn) {
      errors.push({ field: at('ends_on'), message: 'fim antes do inicio' });
    }

    if (
      !Number.isInteger(rate.daily_cents) ||
      rate.daily_cents < 1 ||
      rate.daily_cents > MAX_DAILY_CENTS
    ) {
      errors.push({
        field: at('daily_cents'),
        message: 'daily_cents deve ser um inteiro positivo, em centavos',
      });
    }

    const bonus = rate.promoted_bonus_cents ?? 0;
    if (!Number.isInteger(bonus) || bonus < 0 || bonus > MAX_DAILY_CENTS) {
      errors.push({
        field: at('promoted_bonus_cents'),
        message: 'promoted_bonus_cents deve ser um inteiro em centavos',
      });
    }

    if (errors.length > before) return;

    const overlap = rates.find(
      (other) =>
        fold(other.role) === fold(role) &&
        other.starts_on <= endsOn &&
        startsOn <= other.ends_on,
    );

    if (overlap) {
      errors.push({
        field: at('starts_on'),
        message: `vigencia sobreposta com rates[${overlap.index}] da mesma funcao`,
      });
      return;
    }

    rates.push({
      index,
      role,
      starts_on: startsOn,
      ends_on: endsOn,
      daily_cents: rate.daily_cents,
      promoted_bonus_cents: bonus,
    });
  });

  return rates.map(({ index: _index, ...rate }) => rate);
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

/** O que o POST e o PATCH aceitam em comum, alem dos obrigatorios. */
function validateShared(body, data, errors) {
  for (const [field, validate] of Object.entries(OPTIONAL)) {
    if (body[field] !== undefined) data[field] = validate(body[field], errors);
  }

  if (body.holidays !== undefined) {
    data.holidays = validateHolidays(body.holidays, errors);
  }

  for (const field of ['email_to', 'email_cc']) {
    if (body[field] !== undefined) {
      data[field] = validateEmails(field, body[field], errors);
    }
  }

  if (body.first_payment_daily_only !== undefined) {
    if (typeof body.first_payment_daily_only !== 'boolean') {
      errors.push({
        field: 'first_payment_daily_only',
        message: 'first_payment_daily_only deve ser true ou false',
      });
    } else {
      data.first_payment_daily_only = body.first_payment_daily_only;
    }
  }

  if (body.schedule !== undefined) {
    data.schedule = validateSchedule(body.schedule, errors);
  }

  if (body.rates !== undefined) {
    data.rates = validateRates(body.rates, errors);
  }
}

function validateCreate(body) {
  assertObject(body);

  const errors = [];
  const data = {};

  if (!Number.isInteger(body.company_id) || body.company_id < 1) {
    errors.push({
      field: 'company_id',
      message: 'company_id deve ser o id de uma empresa cadastrada',
    });
  } else {
    data.company_id = body.company_id;
  }

  data.city = requiredText('city', body.city, errors);
  data.state = requiredState(body.state, errors);
  data.development = requiredText('development', body.development, errors);
  data.starts_on = requiredDate('starts_on', body.starts_on, errors);
  data.ends_on = requiredDate('ends_on', body.ends_on, errors);

  if (data.starts_on && data.ends_on && data.ends_on < data.starts_on) {
    errors.push({ field: 'ends_on', message: 'ends_on antes de starts_on' });
  }

  validateShared(body, data, errors);

  assertValid(errors);
  return data;
}

const UPDATABLE = [
  'city',
  'state',
  'development',
  'starts_on',
  'ends_on',
  'holidays',
  ...Object.keys(OPTIONAL),
  'email_to',
  'email_cc',
  'first_payment_daily_only',
  'schedule',
  'rates',
  'status',
];

/**
 * PATCH parcial. O periodo e conferido contra o que ja esta gravado: mudar so
 * o fim para antes do inicio atual tem de dar 422, nao um 500 da constraint.
 */
function validateUpdate(body, current) {
  assertObject(body);

  const errors = [];
  const data = {};

  for (const field of ['city', 'development']) {
    if (body[field] !== undefined) {
      data[field] = requiredText(field, body[field], errors);
    }
  }

  if (body.state !== undefined) {
    data.state = requiredState(body.state, errors);
  }

  for (const field of ['starts_on', 'ends_on']) {
    if (body[field] !== undefined) {
      data[field] = requiredDate(field, body[field], errors);
    }
  }

  const startsOn = data.starts_on ?? current.starts_on;
  const endsOn = data.ends_on ?? current.ends_on;

  if (startsOn && endsOn && endsOn < startsOn) {
    errors.push({ field: 'ends_on', message: 'ends_on antes de starts_on' });
  }

  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) {
      errors.push({
        field: 'status',
        message: 'status deve ser open ou closed',
      });
    } else {
      data.status = body.status;
    }
  }

  validateShared(body, data, errors);

  assertValid(errors);

  if (Object.keys(data).length === 0) {
    throw new ValidationError({
      message: 'Informe ao menos um campo para atualizar.',
      details: [
        {
          field: 'body',
          // A empresa fica de fora: ela da o codigo de todo RPA do lancamento.
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

  if (query.status !== undefined) {
    if (!STATUSES.includes(query.status)) {
      errors.push({
        field: 'status',
        message: 'status deve ser open ou closed',
      });
    } else {
      result.status = query.status;
    }
  }

  assertValid(errors);
  return result;
}

module.exports = {
  validateCreate,
  validateUpdate,
  validateId,
  validateListQuery,
};
