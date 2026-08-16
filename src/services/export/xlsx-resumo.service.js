'use strict';

const ExcelJS = require('exceljs');
const { statusLabel, categoryLabel, CATEGORY_LABELS } = require('./labels');

// `[$R$-416]` e o codigo de moeda pt-BR do Excel. `"R$" #,##0.00` parece
// equivalente, mas nao e: sem o locale, o separador de milhar/decimal segue o
// locale de quem abrir o arquivo, e em en-US 1.320,28 vira 1,320.28.
const CURRENCY_FORMAT = '[$R$-416] #,##0.00';
const DATE_FORMAT = 'DD/MM/YYYY';

// F e uma coluna auxiliar (0/1), oculta, que as formulas usam para excluir
// duplicata do somatorio. Ficar longe de comparar texto de status: SUMIFS
// contra um numero e o que ha de mais chato de quebrar por acidente.
const COLUMNS = [
  'Data',
  'Local',
  'Tipo',
  'Status',
  'Valor (R$)',
  'Excluir do total',
];

/** Serial de data do Excel a partir de 'YYYY-MM-DD', sem passar por Date(). */
function excelSerialDate(isoDate) {
  const epoch = Date.UTC(1899, 11, 30);
  const [year, month, day] = isoDate.split('-').map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - epoch) / 86400000);
}

/**
 * Planilha-resumo do relatorio, gerada do zero (nao e o Anexo I oficial —
 * esse e a Issue 17). Existe para quem quer conferir os lancamentos numa
 * ferramenta que edita e recalcula, sem lidar com a rigidez do template.
 *
 * Os totais sao **formula**, nao valor fixo: o conferente pode editar uma
 * linha e ver o total mudar sozinho, em vez de recalcular na mao.
 */
async function buildResumoWorkbook(report, receipts) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Resumo');

  sheet.addRow(COLUMNS);
  sheet.getRow(1).font = { bold: true };
  sheet.getColumn(6).hidden = true;

  const firstDataRow = 2;

  receipts.forEach((receipt, index) => {
    const row = sheet.getRow(firstDataRow + index);
    const isDuplicate = receipt.status === 'duplicate';

    row.getCell(1).value = receipt.issued_at
      ? excelSerialDate(receipt.issued_at)
      : null;
    row.getCell(1).numFmt = DATE_FORMAT;

    row.getCell(2).value = receipt.merchant_name || '';
    row.getCell(3).value = categoryLabel(receipt.category);
    row.getCell(4).value = isDuplicate
      ? `Duplicata do comprovante #${receipt.duplicate_of_id}`
      : statusLabel(receipt.status);
    row.getCell(5).value = (receipt.amount_cents ?? 0) / 100;
    row.getCell(5).numFmt = CURRENCY_FORMAT;
    row.getCell(6).value = isDuplicate ? 1 : 0;
  });

  const lastDataRow = firstDataRow + receipts.length - 1;
  const range = (col) => `${col}${firstDataRow}:${col}${lastDataRow}`;
  const totalsRow = lastDataRow + 2;

  sheet.getCell(`D${totalsRow}`).value = 'TOTAL';
  sheet.getCell(`D${totalsRow}`).font = { bold: true };
  sheet.getCell(`E${totalsRow}`).value =
    receipts.length > 0
      ? { formula: `SUMIFS(${range('E')},${range('F')},0)` }
      : 0;
  sheet.getCell(`E${totalsRow}`).numFmt = CURRENCY_FORMAT;
  sheet.getCell(`E${totalsRow}`).font = { bold: true };

  let categoryRow = totalsRow + 2;
  for (const category of Object.keys(CATEGORY_LABELS)) {
    if (receipts.length === 0) {
      break;
    }

    const label = categoryLabel(category);
    sheet.getCell(`D${categoryRow}`).value = label;
    sheet.getCell(`E${categoryRow}`).value = {
      formula: `SUMIFS(${range('E')},${range('C')},"${label}",${range('F')},0)`,
    };
    sheet.getCell(`E${categoryRow}`).numFmt = CURRENCY_FORMAT;
    categoryRow += 1;
  }

  sheet.columns.forEach((column) => {
    column.width = 22;
  });

  return workbook;
}

module.exports = { buildResumoWorkbook, excelSerialDate, CURRENCY_FORMAT };
