'use strict';

const { checkTimes } = require('../services/rpa/day-value');

/**
 * Horarios de um dia trabalhado, no horario padrao do lancamento e na grade
 * do ponto: a mesma regra nos dois, para o padrao nunca gerar um dia que a
 * grade recusaria.
 */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function optionalTime(field, value, errors) {
  if (value === undefined || value === null || value === '') return null;

  if (typeof value !== 'string' || !TIME.test(value)) {
    errors.push({ field, message: `${field} deve ser um horario HH:MM` });
    return undefined;
  }

  return value;
}

/**
 * Entrada e saida obrigatorias, almoco com os dois horarios ou nenhum, e a
 * sequencia em ordem — com uma virada da meia-noite, no maximo, para o turno
 * da noite. `at(campo)` da o nome do campo no `details`.
 */
function validateWorkTimes(at, entry, errors) {
  const before = errors.length;
  const times = {
    start_time: optionalTime(at('start_time'), entry.start_time, errors),
    lunch_out: optionalTime(at('lunch_out'), entry.lunch_out, errors),
    lunch_in: optionalTime(at('lunch_in'), entry.lunch_in, errors),
    end_time: optionalTime(at('end_time'), entry.end_time, errors),
  };

  if (times.start_time === null || times.end_time === null) {
    errors.push({
      field: at(times.start_time === null ? 'start_time' : 'end_time'),
      message: 'entrada e saida sao obrigatorias',
    });
  }

  if ((times.lunch_out === null) !== (times.lunch_in === null)) {
    errors.push({
      field: at('lunch_out'),
      message: 'saida e retorno do almoco vao juntos',
    });
  }

  if (errors.length > before) return undefined;

  const problem = checkTimes(times);

  if (problem) {
    errors.push({ field: at('start_time'), message: problem });
    return undefined;
  }

  return times;
}

module.exports = { optionalTime, validateWorkTimes };
