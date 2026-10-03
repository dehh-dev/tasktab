'use strict';

/**
 * CNPJ: normalizacao e digito verificador.
 *
 * Vale a mesma logica da chave de acesso — um identificador com verificador
 * permite recusar o dado errado na entrada, em vez de descobrir semanas depois
 * que a despesa foi vinculada ao emitente errado.
 *
 * **Alfanumerico desde julho de 2026.** Os 12 primeiros caracteres podem ser
 * letras maiusculas; os dois do DV continuam digitos. O calculo e o mesmo
 * mod-11 de sempre, com cada caractere valendo o codigo ASCII menos 48 — o que
 * deixa os digitos com o valor de antes ('0' = 0) e da 'A' = 17. Um CNPJ so de
 * digitos fecha a conta exatamente como fechava.
 */

const LENGTH = 14;
const FORMAT = /^[A-Z0-9]{12}\d{2}$/;

/**
 * Como o CNPJ aparece num texto, com ou sem mascara. Sem `\b` a busca casava
 * 14 digitos no meio da chave de acesso; com letras na jogada, casaria tambem
 * no meio de uma palavra.
 */
const IN_TEXT =
  /(?<![A-Z0-9])[A-Z0-9]{2}\.?[A-Z0-9]{3}\.?[A-Z0-9]{3}\/?[A-Z0-9]{4}-?\d{2}(?![A-Z0-9])/;

/** Letras e digitos, em maiuscula: mascara e coisa de interface. */
function normalize(input) {
  if (typeof input !== 'string' && typeof input !== 'number') {
    return null;
  }

  const cnpj = String(input)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  return FORMAT.test(cnpj) ? cnpj : null;
}

function valueOf(char) {
  return char.charCodeAt(0) - 48;
}

function digitAt(cnpj, weights) {
  const sum = weights.reduce(
    (total, weight, index) => total + valueOf(cnpj[index]) * weight,
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
  if (/^(.)\1{13}$/.test(cnpj)) {
    return false;
  }

  return (
    digitAt(cnpj, FIRST_WEIGHTS) === Number(cnpj[12]) &&
    digitAt(cnpj, SECOND_WEIGHTS) === Number(cnpj[13])
  );
}

/**
 * Um candidato achado no texto serve como CNPJ?
 *
 * So de digitos, vale como sempre valeu, mesmo com o DV errado: e a forma que
 * um erro de OCR toma, e o `classify` ainda confere antes de cadastrar. Com
 * letra, so se fechar o DV — "SUPERMERCADO12" tem o formato de um CNPJ, e sem
 * o verificador qualquer palavra seguida de dois digitos passaria por um.
 */
function plausible(candidate) {
  const cnpj = normalize(candidate);

  if (cnpj === null) {
    return false;
  }

  return /^\d+$/.test(cnpj) || isValid(cnpj);
}

module.exports = { normalize, isValid, plausible, IN_TEXT, LENGTH };
