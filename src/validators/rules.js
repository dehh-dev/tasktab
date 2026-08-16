'use strict';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

/**
 * Valida uma data no formato ISO 'YYYY-MM-DD' rejeitando valores como
 * '2026-02-31', que o Date() normalizaria silenciosamente para 03/03.
 *
 * Repare que a comparacao e toda em UTC: `new Date('2026-02-31')` na timezone
 * local desloca a data em um dia, o mesmo motivo do type parser do OID 1082.
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

/** Compara duas datas ISO sem passar por Date. */
function isoDateNotAfter(start, end) {
  return start <= end;
}

module.exports = { isBlank, isValidIsoDate, isoDateNotAfter };
