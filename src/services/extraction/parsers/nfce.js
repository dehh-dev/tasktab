'use strict';

const normalize = require('../normalize');

/**
 * NFC-e — Nota Fiscal de Consumidor Eletronica.
 *
 * E o formato mais comum do caso-base e o mais previsivel: layout definido em
 * norma, com a chave de acesso de 44 digitos impressa na propria pagina. Achar
 * a chave vale mais que achar qualquer outro campo, porque ela e
 * autodescritiva — carrega CNPJ e ano/mes de emissao — e tem digito
 * verificador, entao valida a propria leitura. A validacao do DV chega na
 * issue 9, junto com o QR Code.
 *
 * O que a chave **nao** carrega e o valor total: esse continua vindo do texto.
 */
const CONFIDENCE = 0.9;

const SIGNATURES = [
  /nfc-?e/i,
  /nota\s+fiscal\s+de\s+consumidor/i,
  /cupom\s+fiscal\s+eletr/i,
];

const ACCESS_KEY = /\b(\d{44})\b/;
// A chave costuma vir impressa em grupos de quatro.
const SPACED_ACCESS_KEY = /\b(?:\d{4}[\s.-]?){10}\d{4}\b/;

const name = 'nfce';

function matches(text) {
  return SIGNATURES.some((signature) => signature.test(text));
}

function findAccessKey(text) {
  const direct = text.match(ACCESS_KEY);

  if (direct) {
    return direct[1];
  }

  const spaced = text.match(SPACED_ACCESS_KEY);

  if (spaced) {
    const digits = spaced[0].replace(/\D/g, '');
    return digits.length === 44 ? digits : null;
  }

  return null;
}

function parse(text) {
  const fields = {};

  const accessKey = findAccessKey(text);

  if (accessKey) {
    fields.access_key = {
      value: accessKey,
      source: 'text',
      confidence: CONFIDENCE,
    };

    // Posicoes 7 a 20 da chave. Vale mais que o CNPJ solto no texto, que pode
    // ser o da operadora do cartao impresso no mesmo cupom.
    fields.cnpj = {
      value: accessKey.slice(6, 20),
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
