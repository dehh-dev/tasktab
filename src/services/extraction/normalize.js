'use strict';

/**
 * Normalizadores de valor e data.
 *
 * Isolado de proposito: e a fonte mais provavel de bug silencioso do projeto.
 * Um valor lido errado nao quebra nada — ele entra na planilha e so aparece na
 * conferencia, semanas depois. Por isso toda funcao aqui devolve `null` quando
 * nao reconhece a entrada: **nunca `NaN`, nunca `0`**. Zero e um valor
 * plausivel e passaria despercebido.
 */

// Ancoras de total, da mais especifica para a mais generica. A ordem importa:
// "VALOR TOTAL" deve ganhar de "TOTAL" numa nota que traga os dois.
const TOTAL_ANCHORS = [
  /valor\s+total\s+(?:d[aeo]\s+nota\s+)?(?:r\$\s*)?/i,
  /total\s+a\s+pagar\s*(?:r\$\s*)?/i,
  /valor\s+a\s+pagar\s*(?:r\$\s*)?/i,
  /valor\s+cobrado\s*(?:r\$\s*)?/i,
  /total\s+geral\s*(?:r\$\s*)?/i,
  /total\s*r\$\s*/i,
  /total\s*:\s*(?:r\$\s*)?/i,
];

// Um numero monetario. A ordem das alternativas importa: a forma com milhar
// vem primeiro, senao `1234,56` casaria so `123` no ramo de tres digitos.
const AMOUNT = /\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?/;

/**
 * Converte texto monetario em centavos.
 *
 * A ambiguidade do ponto e resolvida por uma regra explicita:
 *
 * - ha virgula → a virgula e o decimal e o ponto e milhar (`1.234,56`)
 * - so ponto, seguido de **exatamente 3** digitos no fim → milhar (`1.234` = R$ 1.234,00)
 * - so ponto, seguido de 1 ou 2 digitos → decimal (`59.60` = R$ 59,60)
 *
 * O caso `1.234` e o unico genuinamente ambiguo, e a regra escolhe milhar
 * porque e o que a impressao brasileira usa. Cupom com centavos sempre traz
 * duas casas.
 */
function parseAmountToCents(input) {
  if (typeof input !== 'string' && typeof input !== 'number') {
    return null;
  }

  const text = String(input).trim();

  if (text === '') {
    return null;
  }

  const match = text.match(AMOUNT);

  if (!match) {
    return null;
  }

  const digits = match[0].replace(/\s/g, '');
  let reais;
  let cents = '00';

  if (digits.includes(',')) {
    const [whole, fraction = ''] = digits.split(',');
    reais = whole.replace(/\./g, '');
    cents = fraction.padEnd(2, '0').slice(0, 2);
  } else if (digits.includes('.')) {
    const parts = digits.split('.');
    const last = parts[parts.length - 1];

    if (parts.length === 2 && last.length <= 2) {
      reais = parts[0];
      cents = last.padEnd(2, '0');
    } else {
      // Todos os grupos tem 3 digitos: separador de milhar.
      reais = parts.join('');
    }
  } else {
    reais = digits;
  }

  if (!/^\d+$/.test(reais) || !/^\d{2}$/.test(cents)) {
    return null;
  }

  return Number(reais) * 100 + Number(cents);
}

const DATE_PATTERNS = [
  { regex: /(\d{4})-(\d{2})-(\d{2})/, order: ['year', 'month', 'day'] },
  { regex: /(\d{1,2})\/(\d{1,2})\/(\d{4})/, order: ['day', 'month', 'year'] },
  {
    regex: /(\d{1,2})\/(\d{1,2})\/(\d{2})(?!\d)/,
    order: ['day', 'month', 'shortYear'],
  },
  { regex: /(\d{1,2})-(\d{1,2})-(\d{4})/, order: ['day', 'month', 'year'] },
];

function isRealDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Converte data impressa em string ISO `YYYY-MM-DD`.
 *
 * Repare que nada aqui passa por `new Date(string)`: interpretar
 * '19/06/2026' ou '2026-06-19' com o parser do JS desloca a data em um dia
 * conforme a timezone. E o mesmo motivo do type parser do OID 1082 e do
 * `formatDate` da interface — o terceiro lugar do projeto onde essa armadilha
 * aparece.
 */
function parseDate(input) {
  if (typeof input !== 'string') {
    return null;
  }

  for (const { regex, order } of DATE_PATTERNS) {
    const match = input.match(regex);

    if (!match) {
      continue;
    }

    const parts = {};
    order.forEach((field, index) => {
      parts[field] = match[index + 1];
    });

    const year =
      parts.year !== undefined
        ? Number(parts.year)
        : // Cupom impresso com ano de dois digitos: 2000 + AA. Este projeto
          // lida com documentos recentes, nao com arquivo historico.
          2000 + Number(parts.shortYear);
    const month = Number(parts.month);
    const day = Number(parts.day);

    if (!isRealDate(year, month, day)) {
      return null;
    }

    return [
      String(year).padStart(4, '0'),
      String(month).padStart(2, '0'),
      String(day).padStart(2, '0'),
    ].join('-');
  }

  return null;
}

/**
 * Encontra o total no texto do cupom, **ancorado em palavra-chave**.
 *
 * Nunca use "o maior numero da pagina": a chave de acesso tem 44 digitos, o
 * CNPJ tem 14 e o telefone tem 11 — todos maiores que qualquer valor de
 * refeicao. A ancora e o que separa o total do resto.
 */
function extractTotal(text) {
  if (typeof text !== 'string') {
    return null;
  }

  for (const anchor of TOTAL_ANCHORS) {
    const match = text.match(
      new RegExp(anchor.source + `(${AMOUNT.source})`, 'i'),
    );

    if (match) {
      const cents = parseAmountToCents(match[1]);

      if (cents !== null) {
        return cents;
      }
    }
  }

  return null;
}

/** Primeira data plausivel do texto. */
function extractDate(text) {
  if (typeof text !== 'string') {
    return null;
  }

  for (const { regex } of DATE_PATTERNS) {
    const match = text.match(regex);

    if (match) {
      const parsed = parseDate(match[0]);

      if (parsed !== null) {
        return parsed;
      }
    }
  }

  return null;
}

/** CNPJ com 14 digitos, sem mascara. */
function extractCnpj(text) {
  if (typeof text !== 'string') {
    return null;
  }

  const match = text.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/);

  if (!match) {
    return null;
  }

  return match[0].replace(/\D/g, '');
}

// Linha de item de cupom: codigo, descricao, quantidade, unidade e o valor no
// fim. A ancora e a unidade (UN, KG, PC...), que separa item de qualquer outra
// linha que por acaso termine em numero.
const ITEM_LINE =
  /^\s*\d{1,4}\s+.+?\s+\d+(?:[.,]\d+)?\s*(?:UN|KG|PC|LT|CX|DZ|MT)\b.*?(\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d+,\d{2})\s*$/i;

/**
 * Valores dos itens listados no cupom, em centavos.
 *
 * Conservador de proposito: so reconhece linha com unidade de medida. Um
 * alarme falso na conferencia destroi a confianca mais rapido do que um erro
 * nao detectado — e quem usa a ferramenta ja vem de uma planilha em que nao
 * confiava.
 */
function extractItemTotals(text) {
  if (typeof text !== 'string') {
    return [];
  }

  return text
    .split('\n')
    .map((line) => line.match(ITEM_LINE))
    .filter(Boolean)
    .map((match) => parseAmountToCents(match[1]))
    .filter((cents) => cents !== null);
}

module.exports = {
  parseAmountToCents,
  parseDate,
  extractTotal,
  extractDate,
  extractCnpj,
  extractItemTotals,
};
