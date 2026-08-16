'use strict';

/**
 * CNPJ: normalizacao e digito verificador.
 *
 * Vale a mesma logica da chave de acesso — um identificador com verificador
 * permite recusar o dado errado na entrada, em vez de descobrir semanas depois
 * que a despesa foi vinculada ao emitente errado.
 */

const LENGTH = 14;

/** So digitos: mascara e coisa de interface. */
function normalize(input) {
  if (typeof input !== 'string' && typeof input !== 'number') {
    return null;
  }

  const digits = String(input).replace(/\D/g, '');

  return digits.length === LENGTH ? digits : null;
}

function digitAt(digits, weights) {
  const sum = weights.reduce(
    (total, weight, index) => total + Number(digits[index]) * weight,
    0,
  );
  const remainder = sum % 11;

  return remainder < 2 ? 0 : 11 - remainder;
}

const FIRST_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const SECOND_WEIGHTS = [6, ...FIRST_WEIGHTS];

function isValid(input) {
  const cnpj = normalize(input);

  if (cnpj === null) {
    return false;
  }

  // Sequencias repetidas (00000000000000, 11111111111111) fecham a conta do
  // verificador por acidente, entao precisam ser barradas a parte.
  if (/^(\d)\1{13}$/.test(cnpj)) {
    return false;
  }

  return (
    digitAt(cnpj, FIRST_WEIGHTS) === Number(cnpj[12]) &&
    digitAt(cnpj, SECOND_WEIGHTS) === Number(cnpj[13])
  );
}

module.exports = { normalize, isValid, LENGTH };
