'use strict';

const normalize = require('../normalize');

/**
 * Recibo de corrida da Uber.
 *
 * Layout proprio, sem CNPJ do prestador em destaque e com o total sob a
 * ancora "Total". A data vem por extenso ("19 de junho de 2026"), formato que
 * o normalizador generico nao entende — e a razao principal deste adaptador
 * existir.
 */
const CONFIDENCE = 0.85;

const SIGNATURES = [/\buber\b/i, /obrigado\s+por\s+viajar/i];

const MONTHS = [
  'janeiro',
  'fevereiro',
  'marco',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

const LONG_DATE = /(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})/i;

const name = 'uber';

function matches(text) {
  return SIGNATURES.some((signature) => signature.test(text));
}

function parseLongDate(text) {
  const match = text.match(LONG_DATE);

  if (!match) {
    return null;
  }

  const [, day, monthName, year] = match;
  // Normaliza acentuacao para casar "março" com "marco".
  const normalized = monthName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  const month = MONTHS.indexOf(normalized) + 1;

  if (month === 0) {
    return null;
  }

  return normalize.parseDate(
    `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`,
  );
}

function parse(text) {
  const fields = {};

  const issuedAt = parseLongDate(text);

  if (issuedAt !== null) {
    fields.issued_at = {
      value: issuedAt,
      source: 'text',
      confidence: CONFIDENCE,
    };
  }

  const amount = normalize.extractTotal(text);

  if (amount !== null) {
    fields.amount_cents = {
      value: amount,
      source: 'text',
      confidence: CONFIDENCE,
    };
  }

  return fields;
}

module.exports = { name, matches, parse };
