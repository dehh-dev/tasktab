'use strict';

/**
 * CPF: normalizacao e digito verificador.
 *
 * Mesmo molde do `cnpj.js`: o verificador permite recusar o dado errado na
 * entrada. No RPA isso pesa mais — o CPF e a chave da pessoa dentro do
 * lancamento e e o que casa o recibo assinado com quem recebeu (issue 42).
 */

const LENGTH = 11;

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

function digitAt(cpf, length) {
  const sum = [...cpf.slice(0, length)].reduce(
    (total, digit, index) => total + Number(digit) * (length + 1 - index),
    0,
  );
  const remainder = (sum * 10) % 11;

  return remainder === 10 ? 0 : remainder;
}

function isValid(input) {
  const cpf = normalize(input);

  if (cpf === null) {
    return false;
  }

  // Sequencias repetidas (00000000000, 11111111111) fecham a conta do
  // verificador por acidente, entao precisam ser barradas a parte.
  if (/^(\d)\1{10}$/.test(cpf)) {
    return false;
  }

  return (
    digitAt(cpf, 9) === Number(cpf[9]) && digitAt(cpf, 10) === Number(cpf[10])
  );
}

/**
 * O CPF que perdeu os zeros a esquerda numa planilha.
 *
 * O Google Sheets e o Power Query guardam a resposta do formulario como
 * numero, e 012.345.678-90 vira 1234567890. Com 9 ou 10 digitos, completa com
 * zeros **so se o verificador fechar**: um CPF digitado com um digito a menos
 * continua invalido. Devolve `{ value, padded }`, ou `null`.
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
