'use strict';

/** Espacos repetidos viram um, e as pontas saem. */
function squish(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

/** Sem acento, em minuscula e com os espacos arrumados: para comparar. */
function fold(value) {
  return squish(String(value).normalize('NFD').replace(/\p{M}/gu, ''))
    .toLowerCase()
    .replace(/º|ª/g, '');
}

const CONNECTORS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

/**
 * Nome proprio com cada palavra em maiuscula, menos de/da/do/e. So para o
 * que veio todo em minuscula ou todo em maiuscula: o que a pessoa ja digitou
 * com caixa misturada fica como esta.
 */
function smartCase(value) {
  const text = squish(value);

  if (text !== text.toLowerCase() && text !== text.toUpperCase()) {
    return text;
  }

  return text
    .toLowerCase()
    .split(' ')
    .map((word, index) =>
      index > 0 && CONNECTORS.has(word)
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ');
}

module.exports = { squish, fold, smartCase };
