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

// O que so o passe tolerante conseguiu ler. Baixo o bastante para arrastar a
// confianca do comprovante inteiro para baixo, que e o que faz a linha chegar
// destacada na revisao.
const LOOSE_CONFIDENCE = 0.3;

const name = 'generic';

function matches() {
  return true;
}

function parse(text, { period = null } = {}) {
  const fields = {};

  const amount = normalize.extractTotal(text);
  if (amount !== null) {
    fields.amount_cents = {
      value: amount,
      source: 'text',
      confidence: CONFIDENCE,
    };
  } else {
    // Segunda tentativa, tolerante ao ruido entre a ancora e o numero. Entra
    // com confianca baixa de proposito: o campo chega preenchido, e a revisao
    // recebe o destaque que diz "confira este aqui antes de assinar".
    const loose = normalize.extractLooseTotal(text);
    // Terceira, a forma de pagamento da maquininha: so quando o papel nao
    // tem ancora de total nenhuma, legivel ou suja.
    const card = loose === null ? normalize.extractCardTotal(text) : null;

    if (loose !== null) {
      fields.amount_cents = {
        value: loose,
        source: 'text',
        confidence: LOOSE_CONFIDENCE,
      };
    } else if (card !== null) {
      fields.amount_cents = {
        value: card,
        source: 'text',
        confidence: CONFIDENCE,
      };
    }
  }

  const city = normalize.extractCity(text);
  if (city !== null) {
    fields.city = { value: city, source: 'text', confidence: CONFIDENCE };
  }

  const issuedAt = normalize.extractDate(text, { period });
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
