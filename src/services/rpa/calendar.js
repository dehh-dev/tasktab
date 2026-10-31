'use strict';

/**
 * Datas `YYYY-MM-DD` do ponto, sempre em UTC: `new Date('2026-10-13')` na
 * timezone local anda um dia (ver `src/config/CLAUDE.md`). Comparar duas
 * datas e comparar as strings.
 */
const DAY_MS = 86400000;

function toUtc(date) {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function fromUtc(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(date, days) {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

/** Dia da semana ISO: 1 = segunda, 7 = domingo, como o horario padrao. */
function isoWeekday(date) {
  const day = new Date(toUtc(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Quantos dias de `from` a `to`, os dois inclusive. */
function daysBetween(from, to) {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS) + 1;
}

function eachDate(from, to) {
  const dates = [];

  for (let ms = toUtc(from); ms <= toUtc(to); ms += DAY_MS) {
    dates.push(fromUtc(ms));
  }

  return dates;
}

/** O maior inicio e o menor fim; `null` e "sem limite" daquele lado. */
function latest(...dates) {
  return dates.filter(Boolean).sort().at(-1) ?? null;
}

function earliest(...dates) {
  return dates.filter(Boolean).sort()[0] ?? null;
}

module.exports = {
  addDays,
  isoWeekday,
  daysBetween,
  eachDate,
  latest,
  earliest,
};
