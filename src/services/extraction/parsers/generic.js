'use strict';

const normalize = require('../normalize');

/**
 * Parser de ultimo recurso: vale para qualquer documento com camada de texto.
 *
 * Existe sempre, e por isso a confianca e modesta — ele acha o que da para
 * achar sem conhecer o layout. Um parser especifico so precisa sobrescrever o
 * que sabe fazer melhor, e nao reimplementar o resto.
 */
const CONFIDENCE = 0.6;

const name = 'generic';

function matches() {
  return true;
}

function parse(text) {
  const fields = {};

  const amount = normalize.extractTotal(text);
  if (amount !== null) {
    fields.amount_cents = {
      value: amount,
      source: 'text',
      confidence: CONFIDENCE,
    };
  }

  const issuedAt = normalize.extractDate(text);
  if (issuedAt !== null) {
    fields.issued_at = {
      value: issuedAt,
      source: 'text',
      confidence: CONFIDENCE,
    };
  }

  const cnpj = normalize.extractCnpj(text);
  if (cnpj !== null) {
    fields.cnpj = { value: cnpj, source: 'text', confidence: CONFIDENCE };
  }

  return fields;
}

module.exports = { name, matches, parse };
