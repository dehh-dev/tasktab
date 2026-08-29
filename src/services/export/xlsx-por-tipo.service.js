'use strict';

const ExcelJS = require('exceljs');
const {
  CATEGORY_LABELS,
  categoryKey,
  categoryLabel,
  statusLabel,
} = require('./labels');

// `[$R$-416]` e o codigo de moeda pt-BR do Excel. `"R$" #,##0.00` parece
// equivalente, mas nao e: sem o locale, o separador de milhar/decimal segue o
// locale de quem abrir o arquivo, e em en-US 1.320,28 vira 1,320.28.
const CURRENCY_FORMAT = '[$R$-416] #,##0.00';
const DATE_FORMAT = 'DD/MM/YYYY';

const SUMMARY_SHEET = 'Resumo';

// Ordem das abas: a do enum, com "Sem categoria" no fim. Ordenar por valor
// faria dois relatorios da mesma pessoa saírem com layout diferente, e
// comparar um mes com o outro viraria procurar a linha toda vez.
const CATEGORY_ORDER = [...Object.keys(CATEGORY_LABELS), null];

// Os que ficam de fora do somatorio, na ordem em que interessam a quem
// confere: primeiro o que ainda da trabalho, depois o que ja foi decidido.
const EXCLUDED_STATUSES = [
  'needs_review',
  'pending',
  'processing',
  'duplicate',
  'failed',
];

/** Serial de data do Excel a partir de 'YYYY-MM-DD', sem passar por Date(). */
function excelSerialDate(isoDate) {
  const epoch = Date.UTC(1899, 11, 30);
  const [year, month, day] = isoDate.split('-').map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - epoch) / 86400000);
}

/** 'YYYY-MM-DD' para 'DD/MM/YYYY' sem passar por Date, que desloca o dia. */
function formatDate(isoDate) {
  if (!isoDate) {
    return '';
  }
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Nome de aba aceito pelo Excel: `: \ / ? * [ ]` sao proibidos e o limite e
 * 31 caracteres. Os rotulos de hoje passam inteiros — a normalizacao existe
 * para a proxima categoria do enum nao derrubar a exportacao inteira.
 */
function sheetName(label) {
  return label.replace(/[:\\/?*[\]]/g, '-').slice(0, 31);
}

/**
 * Referencia a um intervalo de outra aba. As aspas simples sao obrigatorias
 * quando o nome tem espaco ou acento (`'Sem categoria'!D2:D5`), e uma aspa
 * dentro do nome se escapa dobrando.
 */
function sheetRange(name, range) {
  return `'${name.replace(/'/g, "''")}'!${range}`;
}

function sumCents(receipts) {
  return receipts.reduce(
    (total, receipt) => total + (receipt.amount_cents ?? 0),
    0,
  );
}

/**
 * Agrupa os confirmados por tipo, na ordem do enum, descartando os tipos sem
 * nenhum lancamento — oito abas vazias so escondem as tres que importam.
 */
function groupByCategory(receipts) {
  return CATEGORY_ORDER.map((key) => ({
    key,
    label: categoryLabel(key),
    receipts: receipts.filter(
      (receipt) => categoryKey(receipt.category) === key,
    ),
  })).filter((group) => group.receipts.length > 0);
}

/** Uma aba por tipo: os lancamentos daquele tipo e o total da aba. */
function addCategorySheet(workbook, group) {
  const sheet = workbook.addWorksheet(sheetName(group.label));

  sheet.addRow(['Data', 'Local', 'Cidade', 'Valor (R$)']);
  sheet.getRow(1).font = { bold: true };

  group.receipts.forEach((receipt, index) => {
    const row = sheet.getRow(2 + index);

    row.getCell(1).value = receipt.issued_at
      ? excelSerialDate(receipt.issued_at)
      : null;
    row.getCell(1).numFmt = DATE_FORMAT;
    row.getCell(2).value = receipt.merchant_name || '';
    row.getCell(3).value = receipt.merchant_city || '';
    row.getCell(4).value = (receipt.amount_cents ?? 0) / 100;
    row.getCell(4).numFmt = CURRENCY_FORMAT;
  });

  const lastDataRow = 1 + group.receipts.length;
  const totalRow = lastDataRow + 2;
  const dataRange = `D2:D${lastDataRow}`;

  sheet.getCell(`C${totalRow}`).value = 'TOTAL';
  sheet.getCell(`C${totalRow}`).font = { bold: true };
  sheet.getCell(`D${totalRow}`).value = { formula: `SUM(${dataRange})` };
  sheet.getCell(`D${totalRow}`).numFmt = CURRENCY_FORMAT;
  sheet.getCell(`D${totalRow}`).font = { bold: true };

  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 38;
  sheet.getColumn(3).width = 20;
  sheet.getColumn(4).width = 16;

  return { name: sheet.name, dataRange };
}

/**
 * Aba de abertura: um tipo por linha, valor puxado da aba daquele tipo.
 *
 * O valor de cada tipo e **formula cruzando abas**, nao numero repetido: quem
 * corrige um lancamento na aba do tipo ve o resumo e o total geral mudarem
 * sozinhos. Repetir o numero aqui criaria duas verdades no mesmo arquivo.
 */
function fillSummarySheet(sheet, report, groups, excluded) {
  sheet.getCell('A1').value = report.title;
  sheet.getCell('A1').font = { bold: true, size: 14 };
  sheet.getCell('A2').value =
    `Periodo: ${formatDate(report.period_start)} a ${formatDate(report.period_end)}`;

  const headerRow = 4;
  sheet.getRow(headerRow).values = ['Tipo', 'Qtd', 'Valor (R$)'];
  sheet.getRow(headerRow).font = { bold: true };

  const firstDataRow = headerRow + 1;

  groups.forEach((group, index) => {
    const row = sheet.getRow(firstDataRow + index);

    row.getCell(1).value = group.label;
    row.getCell(2).value = group.receipts.length;
    row.getCell(3).value = {
      formula: `SUM(${sheetRange(group.sheet.name, group.sheet.dataRange)})`,
    };
    row.getCell(3).numFmt = CURRENCY_FORMAT;
  });

  const lastDataRow = firstDataRow + groups.length - 1;
  const totalRow = groups.length > 0 ? lastDataRow + 2 : firstDataRow + 1;

  sheet.getCell(`A${totalRow}`).value = 'TOTAL';
  sheet.getCell(`A${totalRow}`).font = { bold: true };

  // Sem nenhum tipo, nao ha intervalo para somar: uma formula sobre um
  // intervalo vazio abriria com #REF! na cara de quem so quer ver o zero.
  const hasGroups = groups.length > 0;
  sheet.getCell(`B${totalRow}`).value = hasGroups
    ? { formula: `SUM(B${firstDataRow}:B${lastDataRow})` }
    : 0;
  sheet.getCell(`C${totalRow}`).value = hasGroups
    ? { formula: `SUM(C${firstDataRow}:C${lastDataRow})` }
    : 0;
  sheet.getCell(`C${totalRow}`).numFmt = CURRENCY_FORMAT;
  sheet.getCell(`B${totalRow}`).font = { bold: true };
  sheet.getCell(`C${totalRow}`).font = { bold: true };

  // O que nao entrou fica listado, contado e fora de qualquer soma. Uma
  // planilha que so mostra o confirmado esconde justamente o trabalho que
  // falta — e quem assina descobriria a lacuna depois de assinar.
  if (excluded.length > 0) {
    let row = totalRow + 2;
    sheet.getCell(`A${row}`).value = 'Fora da prestação';
    sheet.getCell(`A${row}`).font = { bold: true };

    for (const item of excluded) {
      row += 1;
      sheet.getCell(`A${row}`).value = item.label;
      sheet.getCell(`B${row}`).value = item.count;
      sheet.getCell(`C${row}`).value = item.cents / 100;
      sheet.getCell(`C${row}`).numFmt = CURRENCY_FORMAT;
    }
  }

  sheet.getColumn(1).width = 26;
  sheet.getColumn(2).width = 10;
  sheet.getColumn(3).width = 18;
}

/**
 * Planilha do relatorio organizada por tipo de despesa: uma aba de resumo e
 * uma aba por tipo com lancamento.
 *
 * So entram comprovantes `confirmed` — o mesmo criterio do Anexo I, e o unico
 * status que significa "uma pessoa olhou e assinou embaixo". Confirmar exige
 * categoria (`receipt.validator`), entao toda linha daqui tem tipo; o grupo
 * "Sem categoria" so aparece se alguem escrever no banco por fora.
 */
async function buildWorkbook(report, receipts) {
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet(SUMMARY_SHEET);

  const confirmed = receipts.filter(
    (receipt) => receipt.status === 'confirmed',
  );

  const groups = groupByCategory(confirmed).map((group) => ({
    ...group,
    sheet: addCategorySheet(workbook, group),
  }));

  const excluded = EXCLUDED_STATUSES.map((status) => {
    const matching = receipts.filter((receipt) => receipt.status === status);
    return {
      status,
      label: statusLabel(status),
      count: matching.length,
      cents: sumCents(matching),
    };
  }).filter((item) => item.count > 0);

  fillSummarySheet(summary, report, groups, excluded);

  return workbook;
}

module.exports = {
  buildWorkbook,
  excelSerialDate,
  sheetName,
  sheetRange,
  SUMMARY_SHEET,
  CURRENCY_FORMAT,
};
