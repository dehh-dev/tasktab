'use strict';

/**
 * PIS/PASEP/NIT: normalizacao e digito verificador.
 *
 * O RPA leva o PIS da pessoa, e o formulario o recebe digitado a mao. O
 * verificador e um mod-11 com pesos proprios, e um DV que daria 10 ou 11 vale
 * 0 — a mesma regra do CNPJ.
 */

const LENGTH = 11;
const WEIGHTS = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function digitsOf(input) {
  if (typeof input !== 'string' && typeof input !== 'number') {
    return null;
  }

  return String(input).replace(/\D/g, '');
}

/** So os 11 digitos: mascara e coisa de interface. */
function normalize(input) {
  const digits = digitsOf(input);

  return digits !== null && digits.length === LENGTH ? digits : null;
}

function checkDigit(pis) {
  const sum = WEIGHTS.reduce(
    (total, weight, index) => total + Number(pis[index]) * weight,
    0,
  );
  const remainder = sum % 11;

  return remainder < 2 ? 0 : 11 - remainder;
}

function isValid(input) {
  const pis = normalize(input);

  if (pis === null) {
    return false;
  }

  // 00000000000 fecha a conta com DV 0, e qualquer sequencia repetida e
  // preenchimento de quem nao sabia o numero.
  if (/^(\d)\1{10}$/.test(pis)) {
    return false;
  }

  return checkDigit(pis) === Number(pis[10]);
}

/**
 * O PIS que perdeu o zero a esquerda numa planilha, como o do `cpf.js`: com
 * 9 ou 10 digitos, completa com zeros so se o verificador fechar. Devolve
 * `{ value, padded }`, ou `null` — o `padded` e o que a importacao registra
 * (issue 37).
 */
function recover(input) {
  const digits = digitsOf(input);

  if (digits === null || digits.length < LENGTH - 2) {
    return null;
  }

  const value = digits.padStart(LENGTH, '0');

  if (!isValid(value)) {
    return null;
  }

  return { value, padded: value !== digits };
}

module.exports = { normalize, isValid, recover, LENGTH };
