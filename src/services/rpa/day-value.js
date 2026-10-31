'use strict';

const { isoWeekday } = require('./calendar');
const { fold } = require('./text');

/**
 * Valor de um dia de trabalho (issue 38), em inteiros.
 *
 * Hora normal = diaria / 8, e o extra por minuto deixa fracao de centavo
 * (diaria / 320 a 50%, diaria / 240 a 100%). A planilha somava essas fracoes
 * e so arredondava no RPA; aqui o valor vai em 1/1920 de centavo, o mesmo
 * denominador de `rpa_payment_days.value_subcents`, e o arredondamento fica
 * para o total do pagamento (issue 39).
 *
 * Por centavo de diaria, um minuto vale 4 subcentavos (1920 / 480); a 50%,
 * 6; a 100%, 8.
 */
const SUBCENTS_PER_CENT = 1920;
const FULL_DAY_MINUTES = 480;
const MINUTES_PER_DAY = 1440;

const EXTRA_SUBCENTS_PER_MINUTE = {
  weekday: 6,
  saturday: 6,
  sunday: 8,
  holiday: 8,
};

// Decisao de quem paga (2026-10-31): domingo e feriado valem duas diarias
// mesmo com menos de 8h. A planilha tirava a dobra do domingo abaixo de 8h.
const DOUBLED = new Set(['sunday', 'holiday']);

function toMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** `75` → `1h15`; `480` → `8h`. */
function formatMinutes(total) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes}min`;
  return minutes === 0
    ? `${hours}h`
    : `${hours}h${String(minutes).padStart(2, '0')}`;
}

/**
 * As marcacoes do dia em minutos desde a meia-noite da entrada. Marcacao
 * menor que a anterior passou da meia-noite — o turno da noite, que a
 * planilha tambem aceitava na volta do almoco.
 */
function timeline({ start_time, lunch_out, lunch_in, end_time }) {
  const marks = [start_time, lunch_out, lunch_in, end_time].filter(
    (time) => time !== null && time !== undefined,
  );
  const absolute = [];
  let offset = 0;

  marks.forEach((time, index) => {
    const clock = toMinutes(time);
    if (index > 0 && clock < toMinutes(marks[index - 1])) {
      offset += MINUTES_PER_DAY;
    }
    absolute.push(clock + offset);
  });

  return absolute;
}

/**
 * O que ha de errado com os horarios de um dia trabalhado, ou `null`. Entrada
 * e saida ja vieram; o almoco, os dois ou nenhum.
 */
function checkTimes(times) {
  const marks = timeline(times);

  for (let index = 1; index < marks.length; index += 1) {
    if (marks[index] === marks[index - 1]) {
      return 'dois horarios iguais em seguida';
    }
  }

  if (marks.at(-1) - marks[0] >= MINUTES_PER_DAY) {
    return 'a jornada chega a 24h: confira a ordem dos horarios';
  }

  return null;
}

function workedMinutes(times) {
  const marks = timeline(times);

  return marks.length === 4
    ? marks[1] - marks[0] + (marks[3] - marks[2])
    : marks[1] - marks[0];
}

function crossesMidnight(times) {
  return timeline(times).at(-1) >= MINUTES_PER_DAY;
}

/** Feriado vale para a equipe inteira e prevalece sobre o dia da semana. */
function dayKind(date, holidays = []) {
  if (holidays.includes(date)) return 'holiday';

  const weekday = isoWeekday(date);
  if (weekday === 7) return 'sunday';
  if (weekday === 6) return 'saturday';
  return 'weekday';
}

/**
 * A diaria vigente da funcao na data, ja com o adicional de promovido a
 * partir da data da promocao. Funcao comparada sem acento nem caixa, como a
 * sobreposicao de vigencias no cadastro.
 */
function dailyCentsFor(rates, worker, date) {
  if (!worker.role) return null;

  const role = fold(worker.role);
  const rate = rates.find(
    (entry) =>
      fold(entry.role) === role &&
      entry.starts_on <= date &&
      date <= entry.ends_on,
  );

  if (!rate) return null;

  const promoted = worker.promoted_since && worker.promoted_since <= date;
  return rate.daily_cents + (promoted ? rate.promoted_bonus_cents : 0);
}

/**
 * Diaria e extra de um dia, separados: o primeiro pagamento leva so as
 * diarias e os extras dele vao no seguinte (issue 39).
 *
 * - Falta (quantidade 0) nao vale nada.
 * - A base e 8h a diaria, 4h a meia diaria. O que passa da base e extra, a
 *   50% no dia util e no sabado, a 100% no domingo e no feriado, sempre com a
 *   hora normal de diaria / 8.
 * - Abaixo da base nao desconta, em dia nenhum: fica `short_minutes`, para
 *   quem lanca decidir entre meia diaria e desconto.
 */
function dayValue({ kind, quantity, workedMinutes: worked, dailyCents }) {
  if (quantity === 0) {
    return {
      daily_subcents: 0,
      extra_subcents: 0,
      extra_minutes: 0,
      short_minutes: 0,
    };
  }

  const base = FULL_DAY_MINUTES * quantity;
  const multiplier = DOUBLED.has(kind) ? 2 : 1;
  const extraMinutes = Math.max(0, worked - base);

  return {
    daily_subcents: dailyCents * SUBCENTS_PER_CENT * quantity * multiplier,
    extra_subcents: extraMinutes * dailyCents * EXTRA_SUBCENTS_PER_MINUTE[kind],
    extra_minutes: extraMinutes,
    short_minutes: Math.max(0, base - worked),
  };
}

module.exports = {
  SUBCENTS_PER_CENT,
  FULL_DAY_MINUTES,
  formatMinutes,
  checkTimes,
  workedMinutes,
  crossesMidnight,
  dayKind,
  dailyCentsFor,
  dayValue,
};
