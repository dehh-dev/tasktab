'use strict';

const cpfRules = require('../../validators/cpf');
const { parseAmountToCents, parseDate } = require('../extraction/normalize');
const { fold, squish } = require('./text');

/**
 * A leitura de uma pagina do recibo assinado (RPCI, issue 42), pura: o texto
 * vem da camada de texto ou do OCR, e daqui sai de quem e e o que diz.
 *
 * O layout do recibo do financeiro varia, entao cada campo e achado pela
 * palavra da linha (`nome`, `liquido`, `data`), nunca pela posicao. O que nao
 * se acha fica `null` e a conferencia aponta.
 */
const MONEY = /(\d{1,3}(?:\.\d{3})+|\d+),\d{2}/g;
const DATE = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/;
// CPF com ou sem mascara, e com o espaco que o OCR poe no lugar do ponto.
const CPF = /(?<!\d)\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}(?!\d)/g;

function lines(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => squish(line))
    .filter(Boolean);
}

/** A linha cuja forma sem acento e sem caixa casa com `pattern`. */
function lineWith(text, pattern) {
  return lines(text).find((line) => pattern.test(fold(line))) ?? null;
}

/**
 * Os CPFs da pagina que fecham o verificador. O DV e o que separa o CPF lido
 * certo do que o OCR trocou um digito: esse nao casa com ninguem.
 */
function readCpfs(text) {
  const found = String(text ?? '').match(CPF) ?? [];
  return [...new Set(found.map((value) => cpfRules.normalize(value)))].filter(
    (cpf) => cpfRules.isValid(cpf),
  );
}

// Palavras dos rotulos do recibo: linha com uma delas nao e o nome de
// ninguem. Vem do RPCI do RH (Senior), onde o nome fica numa linha so dele.
const LABEL_WORDS = new Set([
  'assinatura',
  'cnpj',
  'completo',
  'competencia',
  'cpf',
  'data',
  'demonstrativo',
  'descontos',
  'empresa',
  'endereco',
  'especificacao',
  'identidade',
  'inscricao',
  'liquido',
  'localidade',
  'matricula',
  'nome',
  'razao',
  'recibo',
  'social',
  'totais',
]);

function isLabel(value) {
  const words = fold(value)
    .split(/[^a-z]+/)
    .filter(Boolean);
  return words.length > 0 && words.every((word) => LABEL_WORDS.has(word));
}

/** Linha que e so um nome: letras, duas palavras ou mais, nenhum rotulo. */
function looksLikeName(line) {
  const folded = fold(line);
  if (!/^[a-z' ]+$/.test(folded)) return false;

  const words = folded.split(' ');
  return words.length >= 2 && !words.some((word) => LABEL_WORDS.has(word));
}

/**
 * O nome da pessoa. "Nome: Fulano" vale como esta. O rotulo sozinho ("NOME
 * COMPLETO" do RPCI do RH) tem o nome na linha vizinha: a de baixo na ordem da
 * pagina (OCR), a de cima na camada de texto do Senior. "Nome ou razao
 * social" e a empresa, nunca a pessoa.
 */
function readName(text) {
  const all = lines(text);

  for (let index = 0; index < all.length; index += 1) {
    const line = all[index];
    const folded = fold(line);
    if (!/^nome\b/.test(folded) || /^nome ou razao social\b/.test(folded)) {
      continue;
    }

    const inline = squish(
      line.includes(':')
        ? line.slice(line.indexOf(':') + 1)
        : line.replace(/^\S+/, ''),
    );
    if (inline !== '' && !isLabel(inline)) return inline;

    const neighbour = [all[index + 1], all[index - 1]].find(
      (candidate) => candidate && looksLikeName(candidate),
    );
    if (neighbour) return neighbour;
  }

  return null;
}

/**
 * "a importancia de R$ 650,00" do corpo do RPCI: o valor vem na mesma linha
 * ou na de baixo.
 */
function readImportance(text) {
  const all = lines(text).map((line) => fold(line));
  const phrase = 'importancia de r$';

  for (let index = 0; index < all.length; index += 1) {
    const at = all[index].indexOf(phrase);
    if (at === -1) continue;

    const after = `${all[index].slice(at + phrase.length)} ${all[index + 1] ?? ''}`;
    const value = after.match(MONEY);
    return value ? parseAmountToCents(value[0]) : null;
  }

  return null;
}

/**
 * O liquido: o ultimo valor da linha que diz "liquido". Na camada de texto do
 * RPCI do RH o "LIQUIDO:" vem sem o valor, longe dele; ai vale o mesmo
 * liquido escrito no corpo ("a importancia de R$").
 */
function readNetCents(text) {
  const line = lineWith(text, /liquido/);
  const values = line?.match(MONEY);
  return values ? parseAmountToCents(values.at(-1)) : readImportance(text);
}

/** A data da linha que diz "data"; sem ela, a primeira data da pagina. */
function readDate(text) {
  const line = lineWith(text, /\bdata\b/);
  const found = (line && DATE.exec(line)) ?? DATE.exec(String(text ?? ''));
  return found ? parseDate(found[0]) : null;
}

function words(text) {
  return new Set(
    fold(text)
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
}

/**
 * De quem e a pagina, entre as pessoas do pagamento (`candidates`, com
 * `worker.cpf` e `worker.name`). Primeiro pelo CPF; sem CPF legivel que case,
 * pelo primeiro e ultimo nome do cadastro, quando so uma pessoa os tem na
 * pagina.
 */
function matchPage(text, candidates) {
  const cpfs = readCpfs(text);
  const byCpf = candidates.find((candidate) =>
    cpfs.includes(candidate.worker.cpf),
  );
  if (byCpf) return { candidate: byCpf, by: 'cpf', cpfs };

  const present = words(text);
  const byName = candidates.filter((candidate) => {
    const parts = fold(candidate.worker.name).split(/\s+/).filter(Boolean);
    return (
      parts.length > 0 && present.has(parts[0]) && present.has(parts.at(-1))
    );
  });

  if (byName.length === 1) return { candidate: byName[0], by: 'name', cpfs };
  return { candidate: null, by: null, cpfs };
}

/** O nome lido difere do cadastro? Sem acento, sem caixa e sem espaco a mais. */
function sameName(read, registered) {
  return squish(fold(read)) === squish(fold(registered));
}

module.exports = {
  readCpfs,
  readName,
  readNetCents,
  readDate,
  matchPage,
  sameName,
};
