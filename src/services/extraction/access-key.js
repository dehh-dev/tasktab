'use strict';

/**
 * Chave de acesso da NFe/NFC-e: 44 digitos autodescritivos.
 *
 * E a peca mais valiosa da extracao. Diferente de qualquer outro campo, ela
 * **valida a propria leitura**: o ultimo digito e um verificador mod-11 sobre
 * os 43 anteriores, entao um erro de OCR num digito derruba a chave inteira em
 * vez de passar despercebido. E de quebra carrega CNPJ e ano/mes de emissao,
 * o que resolve emitente e periodo sem OCR nenhum.
 *
 * O que ela **nao** carrega e o valor total — esse continua vindo do texto.
 *
 * Layout:
 *
 * | Posicao | Campo  |
 * | ------- | ------ |
 * | 1–2     | cUF    |
 * | 3–6     | AAMM   |
 * | 7–20    | CNPJ   |
 * | 21–22   | mod    |
 * | 23–25   | serie  |
 * | 26–34   | nNF    |
 * | 35      | tpEmis |
 * | 36–43   | cNF    |
 * | 44      | cDV    |
 */

const LENGTH = 44;

/** Digito verificador mod-11 sobre os 43 primeiros digitos. */
function checkDigit(first43) {
  let sum = 0;
  let weight = 2;

  // Pesos 2..9 ciclando da direita para a esquerda.
  for (let index = first43.length - 1; index >= 0; index -= 1) {
    sum += Number(first43[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }

  const remainder = 11 - (sum % 11);

  // Resto 0 ou 1 produz 11 ou 10, que nao cabem num digito: a norma manda 0.
  return remainder >= 10 ? 0 : remainder;
}

/** Aceita a chave com ou sem os separadores com que costuma ser impressa. */
function normalizeKey(input) {
  if (typeof input !== 'string') {
    return null;
  }

  const digits = input.replace(/\D/g, '');

  return digits.length === LENGTH ? digits : null;
}

function isValid(input) {
  const key = normalizeKey(input);

  if (key === null) {
    return false;
  }

  return checkDigit(key.slice(0, 43)) === Number(key[43]);
}

/**
 * Campos da chave, ou `null` se ela nao for valida.
 *
 * Chave invalida devolve `null` de proposito: aceitar os campos de uma chave
 * que nao fecha o DV seria confiar num dado que a propria norma diz estar
 * errado. Quem chama manda o comprovante para revisao.
 */
function parse(input) {
  const key = normalizeKey(input);

  if (key === null || !isValid(key)) {
    return null;
  }

  const year = 2000 + Number(key.slice(2, 4));
  const month = Number(key.slice(4, 6));

  return {
    key,
    uf: key.slice(0, 2),
    issuedYear: year,
    issuedMonth: month,
    // Primeiro dia do mes de emissao. A chave nao carrega o dia — serve como
    // conferencia da data lida do texto, nao como substituta dela.
    issuedPeriod: `${year}-${String(month).padStart(2, '0')}`,
    cnpj: key.slice(6, 20),
    model: key.slice(20, 22),
    series: key.slice(22, 25),
    number: key.slice(25, 34),
    emissionType: key.slice(34, 35),
    code: key.slice(35, 43),
    checkDigit: Number(key.slice(43)),
  };
}

module.exports = { parse, isValid, checkDigit, normalizeKey, LENGTH };
