'use strict';

const cnpjRules = require('../../validators/cnpj');

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
 *
 * A busca e **linha a linha**, e nao sobre o texto inteiro, porque `\s+` na
 * ancora atravessava a quebra de linha: o cabecalho da tabela de itens termina
 * em "Valor total", a linha seguinte comeca com o codigo do primeiro item, e o
 * total do cupom virava `001` — R$ 1,00 no lugar de R$ 165,00.
 */
function extractTotal(text) {
  if (typeof text !== 'string') {
    return null;
  }

  const lines = text.split('\n');

  for (const anchor of TOTAL_ANCHORS) {
    const regex = new RegExp(anchor.source + `(${AMOUNT.source})`, 'i');

    for (const line of lines) {
      const match = line.match(regex);
      const cents = match ? parseAmountToCents(match[1]) : null;

      if (cents !== null) {
        return cents;
      }
    }
  }

  return null;
}

/**
 * Ancoras de data, da mais confiavel para a menos.
 *
 * A data **nao** e mais "a primeira que aparecer no texto". Numa NFC-e a linha
 * do documento e a linha da autorizacao trazem a mesma data duas vezes, e o
 * OCR erra uma das duas: num cupom real deste projeto o texto dizia
 * `NiC-e nº 000003210 Séria 012 02/06/2026` e, tres linhas abaixo,
 * `Data de Autorização 02/08/2026`. A primeira venceu, e agosto virou junho na
 * planilha assinada. A autorizacao e carimbo do SEFAZ e vale mais que o que o
 * equipamento imprimiu.
 */
const DATE_ANCHORS = [
  /data\s+(?:d[aeo]\s+)?autoriza[çc][ãa]o\s*:?\s*/i,
  /data\s+(?:d[aeo]\s+)?emiss[ãa]o\s*:?\s*/i,
  /autoriza[çc][ãa]o\s*:?\s*/i,
  /emiss[ãa]o\s*:?\s*/i,
  /data\s*:?\s*/i,
];

// Folga entre a ancora e o valor, sem atravessar linha. O OCR intercala
// sujeira curta ("Data de Autorização: ,") com frequencia suficiente para
// exigir isso, e frequencia baixa demais para justificar mais que isso.
const ANCHOR_GAP = '[^\\n]{0,12}?';

/** Primeira data plausivel do texto, sem ancora nenhuma. */
function firstDate(text) {
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

/**
 * Data do documento, **ancorada em palavra-chave** — mesma disciplina do
 * `extractTotal`, e pelo mesmo motivo: sem ancora, ganha o numero que estiver
 * mais acima na pagina, que nao tem relacao nenhuma com o numero certo.
 *
 * Sem ancora nenhuma, a primeira data plausivel ainda e melhor que nada: o
 * campo vem preenchido e a revisao confere. Devolver `null` obrigaria a
 * digitar do zero justamente no cupom que o OCR ja leu pior.
 */
function extractDate(text) {
  if (typeof text !== 'string') {
    return null;
  }

  for (const anchor of DATE_ANCHORS) {
    for (const { regex } of DATE_PATTERNS) {
      const match = text.match(
        new RegExp(anchor.source + ANCHOR_GAP + `(${regex.source})`, 'i'),
      );

      const parsed = match ? parseDate(match[1]) : null;

      if (parsed !== null) {
        return parsed;
      }
    }
  }

  return firstDate(text);
}

const UFS = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
];

// Palavras que so aparecem no meio de um nome de cidade, nunca no fim. Sao o
// que distingue "RIO DE JANEIRO/RJ" de "SERRINHA FORTALEZA-CE", onde
// SERRINHA e o bairro e a cidade e so a ultima palavra.
const CITY_CONNECTORS = new Set([
  'DE',
  'DA',
  'DO',
  'DAS',
  'DOS',
  'SAO',
  'SÃO',
  'SANTA',
  'SANTO',
  'NOVA',
  'NOVO',
  'PORTO',
  'CAMPO',
  'CAMPOS',
  'BELO',
  'BELA',
  'RIO',
  'VILA',
  'MONTE',
  'SERRA',
  'BOA',
  'BOM',
  'CRUZ',
  'PRESIDENTE',
  'GOVERNADOR',
  'CONCEICAO',
  'CONCEIÇÃO',
  'BARRA',
  'LAGOA',
  'POCO',
  'POÇO',
  'SETE',
  'TRES',
  'TRÊS',
]);

// A inicial e maiuscula, o resto nao precisa ser: metade dos cupons imprime o
// endereco em caixa alta e a outra metade em caixa mista ("Fazendinha,
// Itapipoca /CE"). Exigir caixa alta perdia essa metade em silencio.
const CITY_UF = new RegExp(
  `([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-Za-zÀ-ÿ' ]{2,40})\\s*[-/]\\s*(${UFS.join('|')})\\b`,
);

/**
 * Cidade e UF do endereco impresso, no formato `Cidade/UF`.
 *
 * O endereco vem numa linha so, sem separador entre bairro e cidade
 * (`... 2800 SERRINHA FORTALEZA-CE 60714-242`), entao a cidade e reconstruida
 * de tras para frente: a ultima palavra antes da UF, mais as anteriores
 * enquanto forem conectores. E o que devolve `Fortaleza/CE` ali e
 * `Rio De Janeiro/RJ` num endereco carioca, sem precisar de lista de
 * municipios.
 */
function extractCity(text) {
  if (typeof text !== 'string') {
    return null;
  }

  const match = text.match(CITY_UF);

  if (!match) {
    return null;
  }

  const words = match[1].trim().split(/\s+/);
  const taken = [words[words.length - 1]];

  for (let i = words.length - 2; i >= 0; i -= 1) {
    if (!CITY_CONNECTORS.has(words[i].toUpperCase())) {
      break;
    }
    taken.unshift(words[i]);
  }

  const city = taken.map(titleCase).join(' ');

  return city.length >= 3 ? `${city}/${match[2]}` : null;
}

function titleCase(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Primeiro CNPJ plausivel do texto, sem mascara. */
function extractCnpj(text) {
  if (typeof text !== 'string') {
    return null;
  }

  const anywhere = new RegExp(cnpjRules.IN_TEXT.source, 'g');

  for (const [candidate] of text.matchAll(anywhere)) {
    if (cnpjRules.plausible(candidate)) {
      return cnpjRules.normalize(candidate);
    }
  }

  return null;
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

/**
 * Total quando a ancora existe mas o OCR sujou o que vem logo depois.
 *
 * Num posto de combustivel real a linha saiu como
 * `.. VALOR TOTAL Ri 2... 2.225,49`: a ancora esta la, e o `Ri 2... ` entre ela
 * e o numero derruba a leitura estrita. Aqui a folga e permitida e vence o
 * **ultimo** valor da linha, que e onde o total e impresso.
 *
 * Separado de `extractTotal` de proposito, e nao embutido nele: o que sai daqui
 * vale menos, entra com confianca menor e por isso chega destacado na revisao.
 * Misturar os dois faria um palpite passar por leitura.
 */
function extractLooseTotal(text) {
  if (typeof text !== 'string') {
    return null;
  }

  const lines = text.split('\n');
  const amounts = new RegExp(AMOUNT.source, 'gi');

  for (const anchor of TOTAL_ANCHORS) {
    const regex = new RegExp(anchor.source, 'i');

    for (const line of lines) {
      const match = line.match(regex);

      if (!match) {
        continue;
      }

      const rest = line.slice(match.index + match[0].length).match(amounts);
      const cents = rest ? parseAmountToCents(rest[rest.length - 1]) : null;

      if (cents !== null) {
        return cents;
      }
    }
  }

  return null;
}

module.exports = {
  parseAmountToCents,
  parseDate,
  extractTotal,
  extractLooseTotal,
  extractDate,
  extractCity,
  extractCnpj,
  extractItemTotals,
};
