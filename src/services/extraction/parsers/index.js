'use strict';

const generic = require('./generic');
const nfce = require('./nfce');
const uber = require('./uber');

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

/**
 * Nome provavel do emitente: a primeira linha nao vazia do cupom.
 *
 * Serve apenas para dar um rotulo legivel ao emitente recem-cadastrado, e
 * **nunca** para decidir categoria. Errar o nome custa uma edicao; errar a
 * categoria por palavra-chave produz planilha errada em silencio.
 */
function merchantName(text) {
  if (typeof text !== 'string') {
    return null;
  }

  const first = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 3);

  return first ? first.slice(0, 255) : null;
}

module.exports = { parse, resolve, merchantName, PARSERS };
