'use strict';

const generic = require('./generic');
const nfce = require('./nfce');
const uber = require('./uber');
const cnpjRules = require('../../../validators/cnpj');

/**
 * Registro de adaptadores por emitente.
 *
 * Acrescentar um emitente novo e acrescentar um arquivo aqui: o nucleo nao
 * muda. A ordem vale — o primeiro que reconhecer o texto ganha —, e o
 * `generic` fica de fora da lista porque ele e o piso, nao um concorrente.
 *
 * **Aviso de precisao:** os adaptadores especificos foram escritos a partir do
 * layout documentado de cada formato, e nao de amostras reais (que trazem CPF
 * e CNPJ de terceiros e por isso nao sao versionadas). Antes de confiar num
 * deles em producao, rode-o contra um documento de verdade. Enquanto isso, o
 * dano possivel e limitado: nada aqui confirma um lancamento sozinho — tudo
 * cai em `needs_review`.
 */
const PARSERS = [nfce, uber];

function resolve(text) {
  return PARSERS.find((parser) => parser.matches(text)) || null;
}

/**
 * Campos extraidos do texto, no formato `{ campo: { value, source,
 * confidence } }`.
 *
 * O generico roda sempre e forma a base; o parser especifico sobrescreve
 * apenas o que sabe fazer melhor. E o que evita que um adaptador novo precise
 * reimplementar data e CNPJ so para acertar o total.
 */
function parse(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { parser: null, fields: {} };
  }

  const fields = generic.parse(text);
  const parser = resolve(text);

  if (!parser) {
    return { parser: generic.name, fields };
  }

  return { parser: parser.name, fields: { ...fields, ...parser.parse(text) } };
}

// Razao social impressa junto do CNPJ. E a ancora mais confiavel que o cupom
// oferece para o nome: o CNPJ tem forma fixa, entao o que vem colado nele e
// texto de cadastro, nao ruido de digitalizacao.
// `[^\S\n]*` e nao `\s*`: `\s` engole a quebra de linha, e a razao social
// virava a linha de endereco logo abaixo do CNPJ. Mesma armadilha da ancora do
// total em `normalize.js`.
// O CNPJ pode ter letra (alfanumerico, 2026); `plausible` barra a palavra
// comum que so tem o formato de um.
const CNPJ_LINE = new RegExp(
  `(${cnpjRules.IN_TEXT.source})[^\\S\\n]*(.{4,120})$`,
  'gm',
);

// Quanto de uma linha precisa ser letra ou espaco para ela passar por nome. O
// lixo tipico do OCR (": 40) 47 DL? “o") fica bem abaixo disso; um nome de
// verdade, mesmo com um caractere lido errado, fica bem acima.
const MIN_ALPHA_RATIO = 0.7;

function alphaRatio(line) {
  const letters = line.replace(/[^A-Za-zÀ-ÿ ]/g, '').length;
  return line.length === 0 ? 0 : letters / line.length;
}

/** Tira pontuacao e sujeira das pontas sem mexer no miolo do nome. */
function clean(line) {
  return line
    .replace(/^[^A-Za-zÀ-ÿ0-9]+/, '')
    .replace(/[^A-Za-zÀ-ÿ0-9.)]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeName(line) {
  return line.length >= 5 && alphaRatio(line) >= MIN_ALPHA_RATIO;
}

/**
 * Nome provavel do emitente.
 *
 * **Nao e mais "a primeira linha nao vazia".** Num PDF escaneado a primeira
 * linha e a margem do papel, e o OCR devolve dela coisas como `: 40) 47 DL? “o`
 * — que era o nome com que 5 dos 19 emitentes deste projeto foram cadastrados.
 *
 * A ordem tenta o mais estruturado primeiro:
 *
 * 1. o que vem depois do CNPJ na linha do CNPJ (a razao social);
 * 2. a primeira linha do topo que pareca nome, medida por proporcao de letras.
 *
 * Continua servindo so de rotulo legivel. A categoria sugerida vem de
 * `category-guess.js`, chega marcada como palpite, e nada aqui confirma nada.
 */
function merchantName(text) {
  if (typeof text !== 'string') {
    return null;
  }

  const fromCnpj = [...text.matchAll(CNPJ_LINE)].find(([, cnpj]) =>
    cnpjRules.plausible(cnpj),
  );

  if (fromCnpj) {
    const candidate = clean(fromCnpj[2]);

    if (looksLikeName(candidate)) {
      return candidate.slice(0, 255);
    }
  }

  // So o topo do documento: mais abaixo comecam os itens, e uma descricao de
  // produto tambem passa no teste de "parece nome".
  const fromTop = text.split('\n').slice(0, 8).map(clean).find(looksLikeName);

  return fromTop ? fromTop.slice(0, 255) : null;
}

module.exports = { parse, resolve, merchantName, PARSERS };
