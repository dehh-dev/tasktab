'use strict';

/**
 * Avaliador minimo das formulas que as exportacoes gravam, resolvido contra
 * as celulas de um workbook ja carregado.
 *
 * Existe porque o exceljs grava a formula mas nao a calcula: sem resolver o
 * intervalo, um teste so consegue afirmar que a string da formula e a que se
 * esperava — e foi exatamente esse o buraco por onde passou um subtotal que
 * apontava para um rotulo que nenhuma linha usava. Aqui cada referencia e lida
 * celula a celula, entao o teste falha quando a formula aponta para o lugar
 * errado, mesmo que o texto dela pareca certo.
 *
 * Cobre so o que as exportacoes usam: numero, texto, referencia e intervalo
 * (com ou sem aba e `$`), `+ - * / &`, comparacoes, e SUM, COUNTIF, SUMIF,
 * ROUND, IF e AND — com a regra do Excel de comparar texto sem caixa.
 */

const TOKENS = [
  ['number', /^\d+(?:\.\d+)?/],
  ['string', /^"((?:[^"]|"")*)"/],
  ['function', /^([A-Z][A-Z0-9.]*)\(/],
  [
    'reference',
    /^(?:'((?:[^']|'')+)'!|([^\s'"!(),:=<>&+\-*/]+)!)?(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?/,
  ],
  ['operator', /^(?:<=|>=|<>|[-+*/&=<>(),])/],
];

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

function tokenize(formula) {
  const tokens = [];
  let rest = formula.trim();

  while (rest.length > 0) {
    const found = TOKENS.map(([type, pattern]) => [
      type,
      pattern.exec(rest),
    ]).find(([, match]) => match);

    if (!found) {
      throw new Error(`formula fora do suportado pelo helper: ${formula}`);
    }

    const [type, match] = found;
    tokens.push({ type, match });
    rest = rest.slice(match[0].length).trimStart();
  }

  return tokens;
}

function columnToNumber(letters) {
  return [...letters].reduce(
    (total, letter) => total * 26 + (letter.charCodeAt(0) - 64),
    0,
  );
}

function numberToColumn(number) {
  let letters = '';

  for (let rest = number; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters;
  }

  return letters;
}

function splitAddress(address) {
  const [, column, row] = /^\$?([A-Z]+)\$?(\d+)$/.exec(address);
  return { column: columnToNumber(column), row: Number(row) };
}

/** Os enderecos do intervalo, linha a linha — dois intervalos do mesmo tamanho andam juntos. */
function addressesOf(start, end) {
  const from = splitAddress(start);
  const to = splitAddress(end);
  const addresses = [];

  for (let row = from.row; row <= to.row; row += 1) {
    for (let column = from.column; column <= to.column; column += 1) {
      addresses.push(`${numberToColumn(column)}${row}`);
    }
  }

  return addresses;
}

function asNumber(value) {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (value === null || value === '') {
    return 0;
  }
  throw new Error(`esperava numero, veio ${JSON.stringify(value)}`);
}

function asText(value) {
  return value === null ? '' : String(value);
}

function sameText(a, b) {
  return (
    asText(a).toLocaleLowerCase('pt-BR') ===
    asText(b).toLocaleLowerCase('pt-BR')
  );
}

/** Criterio de COUNTIF/SUMIF: "" casa celula vazia; texto, sem caixa. */
function matches(value, criterion) {
  if (criterion === null || criterion === '') {
    return value === null || value === '';
  }
  if (typeof criterion === 'number') {
    return value === criterion;
  }
  return typeof value === 'string' && sameText(value, criterion);
}

function compare(operator, left, right) {
  const textual = typeof left === 'string' || typeof right === 'string';
  const a = textual ? asText(left).toLocaleLowerCase('pt-BR') : asNumber(left);
  const b = textual
    ? asText(right).toLocaleLowerCase('pt-BR')
    : asNumber(right);

  switch (operator) {
    case '=':
      return a === b;
    case '<>':
      return a !== b;
    case '<':
      return a < b;
    case '>':
      return a > b;
    case '<=':
      return a <= b;
    default:
      return a >= b;
  }
}

// Somar reais em float traz 89.60000000000001 do mesmo jeito que trouxe no
// caso que originou o projeto — aqui a resposta e so para comparacao.
function cents(value) {
  return Math.round(value * 100) / 100;
}

/** Arredonda como o Excel: metade para longe do zero. */
function round(value, places) {
  const factor = 10 ** places;
  return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
}

/** Valor da celula: a formula resolvida, a data como serial do Excel. */
function evaluateCell(workbook, sheetName, address) {
  const sheet = workbook.getWorksheet(sheetName);

  if (!sheet) {
    throw new Error(`a formula referencia uma aba inexistente: ${sheetName}`);
  }

  const value = sheet.getCell(address.replace(/\$/g, '')).value;

  if (value instanceof Date) {
    return (value.getTime() - EXCEL_EPOCH) / 86400000;
  }
  if (value && typeof value.formula === 'string') {
    return evaluateFormula(workbook, sheet.name, value.formula);
  }
  if (value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text).join('');
  }

  return value ?? null;
}

function evaluateFormula(workbook, sheetName, formula) {
  const tokens = tokenize(formula);
  let position = 0;

  const peek = () => tokens[position];
  const isOperator = (...values) =>
    peek()?.type === 'operator' && values.includes(peek().match[0]);

  function take(value) {
    const token = tokens[position];

    if (!token || token.match[0] !== value) {
      throw new Error(`esperava "${value}" em ${formula}`);
    }

    position += 1;
  }

  function values(range) {
    return range.addresses.map((address) =>
      evaluateCell(workbook, range.sheet, address),
    );
  }

  function call(name, args) {
    switch (name) {
      case 'SUM':
        return cents(
          args
            .flatMap((arg) => (arg?.addresses ? values(arg) : [arg]))
            .filter((value) => typeof value === 'number')
            .reduce((total, value) => total + value, 0),
        );
      case 'COUNTIF':
        return values(args[0]).filter((value) => matches(value, args[1]))
          .length;
      case 'SUMIF': {
        const sums = values(args[2]);
        return cents(
          values(args[0]).reduce(
            (total, value, index) =>
              matches(value, args[1]) && typeof sums[index] === 'number'
                ? total + sums[index]
                : total,
            0,
          ),
        );
      }
      case 'ROUND':
        return round(asNumber(args[0]), asNumber(args[1]));
      case 'IF':
        return args[0] ? args[1] : args[2];
      case 'AND':
        return args.every(Boolean);
      default:
        throw new Error(`funcao fora do suportado pelo helper: ${name}`);
    }
  }

  function primary() {
    const token = tokens[position];
    position += 1;

    if (!token) {
      throw new Error(`formula incompleta: ${formula}`);
    }

    const { type, match } = token;

    if (type === 'number') {
      return Number(match[0]);
    }
    if (type === 'string') {
      return match[1].replace(/""/g, '"');
    }
    if (type === 'reference') {
      const sheet = match[1]
        ? match[1].replace(/''/g, "'")
        : (match[2] ?? sheetName);

      return match[4]
        ? { sheet, addresses: addressesOf(match[3], match[4]) }
        : evaluateCell(workbook, sheet, match[3]);
    }
    if (type === 'function') {
      const args = [];

      while (!isOperator(')')) {
        args.push(comparison());

        if (isOperator(',')) {
          take(',');
        }
      }

      take(')');
      return call(match[1], args);
    }
    if (match[0] === '(') {
      const value = comparison();
      take(')');
      return value;
    }

    throw new Error(`"${match[0]}" fora do lugar em ${formula}`);
  }

  function unary() {
    if (isOperator('-')) {
      take('-');
      return -asNumber(unary());
    }
    return primary();
  }

  function term() {
    let value = unary();

    while (isOperator('*', '/')) {
      const operator = tokens[position].match[0];
      position += 1;
      const right = asNumber(unary());
      value =
        operator === '*' ? asNumber(value) * right : asNumber(value) / right;
    }

    return value;
  }

  function additive() {
    let value = term();

    while (isOperator('+', '-', '&')) {
      const operator = tokens[position].match[0];
      position += 1;
      const right = term();

      if (operator === '&') {
        value = asText(value) + asText(right);
      } else {
        value =
          operator === '+'
            ? asNumber(value) + asNumber(right)
            : asNumber(value) - asNumber(right);
      }
    }

    return value;
  }

  function comparison() {
    let value = additive();

    while (isOperator('=', '<>', '<', '>', '<=', '>=')) {
      const operator = tokens[position].match[0];
      position += 1;
      value = compare(operator, value, additive());
    }

    return value;
  }

  const result = comparison();

  if (position !== tokens.length) {
    throw new Error(`sobrou formula sem avaliar: ${formula}`);
  }

  return result;
}

/**
 * Numero da primeira linha em que a coluna indicada tem exatamente esse
 * texto. Procurar pelo rotulo, e nao por um endereco fixo, e o que permite a
 * planilha ganhar uma linha de cabecalho sem reescrever a suite inteira.
 */
function findRow(sheet, label, column = 1) {
  let found = null;

  sheet.eachRow((row, number) => {
    if (found === null && row.getCell(column).value === label) {
      found = number;
    }
  });

  if (found === null) {
    throw new Error(`nenhuma linha com "${label}" na aba ${sheet.name}`);
  }

  return found;
}

module.exports = { evaluateCell, findRow };
