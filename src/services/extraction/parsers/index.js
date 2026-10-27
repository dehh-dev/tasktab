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
function parse(text, { period = null } = {}) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { parser: null, fields: {} };
  }

  // `period` e o `YYYY-MM` da chave de acesso ja validada: a data e escolhida
  // entre as que o papel traz, preferindo a que concorda com ele.
  const fields = generic.parse(text, { period });
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

// A linha do CNPJ como o OCR a devolve de papel amassado: o rotulo lido como
// "GNPJ" ou "CNP)", espaco no meio dos digitos ("21 .417.280/0001-08",
// "02 330.130/0001-18"). Em Avare foram 6 de 11 cupons, e o nome virava a
// linha de endereco logo abaixo. So digitos aqui: o CNPJ com letra que o OCR
// nao quebrou ja casa no `CNPJ_LINE`, e aceitar letra no meio da folga
// comeria o comeco da razao social.
const LOOSE_CNPJ_LINE =
  /\b[CG]NP[J)](?:\/CPF)?[^\S\n]*:?[^\S\n]*((?:\d[^\S\n]*[./-]?[^\S\n]*){13}\d)(.*)$/i;

// Data e hora coladas no fim da linha, como a maquininha imprime ao lado do
// CNPJ ("22/10/2026 + 20:47") ou da razao social ("13,10,26-07:54").
const TRAILING_DATE =
  /[^\S\n]+\d{1,2}[.,/-]\d{1,2}[.,/-]\d{2,4}(?:[^\S\n]*[-+][^\S\n]*|[^\S\n]+)?(?:\d{1,2}:\d{2}(?::\d{2})?)?[^\S\n]*$/;

// Endereco nao e nome, mesmo com proporcao de letras de nome.
const ADDRESS =
  /^(?:av(?:enida)?|rua|r\.|rod(?:ovia)?|al(?:ameda)?|travessa|tv\.|pra[çc]a|estrada)\b/i;

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

function asName(line) {
  const candidate = clean((line ?? '').replace(TRAILING_DATE, ''));
  return looksLikeName(candidate) ? candidate.slice(0, 255) : null;
}

/** Primeira linha com CNPJ: o indice dela e o que vem depois do numero. */
function findCnpjLine(lines) {
  for (const [index, line] of lines.entries()) {
    const strict = [...line.matchAll(CNPJ_LINE)].find(([, cnpj]) =>
      cnpjRules.plausible(cnpj),
    );

    if (strict) {
      return { index, rest: strict[2] };
    }

    const loose = line.match(LOOSE_CNPJ_LINE);

    if (loose && cnpjRules.plausible(loose[1].replace(/\D/g, ''))) {
      return { index, rest: loose[2] };
    }
  }

  return null;
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
 * 0. o nome fixo do adaptador, quando o documento e de um emitente so (o
 *    recibo da Uber nao traz razao social, e o topo dele e "Obrigado por
 *    viajar, Fulano");
 * 1. o que vem depois do CNPJ na linha do CNPJ (a razao social), mesmo com o
 *    numero quebrado pelo OCR;
 * 2. a linha logo acima do CNPJ, quando a dele so traz data e hora — e o
 *    comprovante da maquininha (Stone, Rede), que imprime o nome em cima;
 * 3. a primeira linha do topo que pareca nome, medida por proporcao de letras.
 *
 * Continua servindo so de rotulo legivel. A categoria sugerida vem de
 * `category-guess.js`, chega marcada como palpite, e nada aqui confirma nada.
 */
function merchantName(text) {
  if (typeof text !== 'string') {
    return null;
  }

  const fixed = resolve(text)?.issuer;

  if (fixed) {
    return fixed;
  }

  const lines = text.split('\n');
  const cnpjLine = findCnpjLine(lines);

  if (cnpjLine) {
    const sameLine = asName(cnpjLine.rest);

    if (sameLine) {
      return sameLine;
    }

    const above = lines[cnpjLine.index - 1] ?? '';

    if (!ADDRESS.test(clean(above))) {
      const aboveName = asName(above);

      if (aboveName) {
        return aboveName;
      }
    }
  }

  // So o topo do documento: mais abaixo comecam os itens, e uma descricao de
  // produto tambem passa no teste de "parece nome".
  const fromTop = text.split('\n').slice(0, 8).map(clean).find(looksLikeName);

  return fromTop ? fromTop.slice(0, 255) : null;
}

module.exports = { parse, resolve, merchantName, PARSERS };
