'use strict';

/**
 * Gera o template SINTETICO usado pela Issue 26/17 em `assets/anexo-i-template.xlsx`.
 *
 * **Isto NAO e o formulario oficial.** Nao existe, neste projeto, o arquivo
 * real do Anexo I — decisao tomada com o usuario ao iniciar o M6. O
 * sintetico reproduz a mesma estrutura descrita no backlog (formulas,
 * celulas mescladas, lista suspensa de validacao, linha de totais cobrindo
 * o intervalo inteiro) para provar a tecnica de remendo de XML descrita na
 * Issue 17. **Antes de qualquer uso real, troque este arquivo pelo
 * formulario oficial e confira se o mapa de colunas em
 * `src/services/export/anexo-i.service.js` ainda bate.**
 *
 * Roda uma vez, offline — nao faz parte do runtime da aplicacao.
 * `npm run generate:anexo-i-template`
 */

const path = require('path');
const ExcelJS = require('exceljs');

const OUTPUT = path.resolve(__dirname, '../assets/anexo-i-template.xlsx');

const FIRST_DATA_ROW = 32;
const LAST_DATA_ROW = 100;
const TOTALS_ROW = 101;

// As colunas de valor do formulario versao 19, como o procedimento de
// prestacao de contas as descreve. O total da linha (Y) cobre as seis: com
// so S, W e X, o valor de taxi lancado em Q sumiria do total.
const VALUE_COLUMNS = {
  O: 'Passagens',
  Q: 'Taxi/Conducoes',
  S: 'Alimentacao',
  U: 'Hospedagem',
  W: 'Combustivel',
  X: 'Outras',
};
const CURRENCY = '[$R$-416] #,##0.00';

async function main() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Anexo I');

  sheet.mergeCells('A1:Y1');
  sheet.getCell('A1').value =
    'PRESTACAO DE CONTAS — ANEXO I (MODELO SINTETICO, NAO OFICIAL)';
  sheet.getCell('A1').font = { bold: true };

  sheet.getCell('B3').value = 'Adiantamento recebido';
  sheet.getCell('C3').value = 0;
  sheet.getCell('C3').numFmt = '[$R$-416] #,##0.00';

  sheet.getCell('B4').value = 'Saldo (adiantamento - total)';
  sheet.getCell('C4').value = { formula: `C3-Y${TOTALS_ROW}` };
  sheet.getCell('C4').numFmt = '[$R$-416] #,##0.00';

  const header = {
    B: 'Data',
    C: 'Cidade',
    G: 'Descricao',
    ...VALUE_COLUMNS,
    T: 'Pagamento',
    Y: 'Total',
  };
  for (const [col, label] of Object.entries(header)) {
    sheet.getCell(`${col}${FIRST_DATA_ROW - 1}`).value = label;
    sheet.getCell(`${col}${FIRST_DATA_ROW - 1}`).font = { bold: true };
  }

  const valueColumns = Object.keys(VALUE_COLUMNS);

  for (let row = FIRST_DATA_ROW; row <= LAST_DATA_ROW; row += 1) {
    sheet.getCell(`B${row}`).numFmt = 'DD/MM/YYYY';

    for (const col of valueColumns) {
      sheet.getCell(`${col}${row}`).value = 0;
      sheet.getCell(`${col}${row}`).numFmt = CURRENCY;
    }

    sheet.getCell(`Y${row}`).value = {
      formula: valueColumns.map((col) => `${col}${row}`).join('+'),
    };
    sheet.getCell(`Y${row}`).numFmt = CURRENCY;

    // Lista suspensa por linha, numa coluna que o remendo da Issue 17 NUNCA
    // toca — e o que prova que o patch preserva validacao de dados.
    sheet.getCell(`T${row}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"Dinheiro,Cartao,Pix"'],
    };
  }

  for (const col of [...valueColumns, 'Y']) {
    const cell = sheet.getCell(`${col}${TOTALS_ROW}`);
    cell.value = {
      formula: `SUM(${col}${FIRST_DATA_ROW}:${col}${LAST_DATA_ROW})`,
    };
    cell.numFmt = CURRENCY;
    cell.font = { bold: true };
  }
  sheet.getCell(`B${TOTALS_ROW}`).value = 'TOTAIS';
  sheet.getCell(`B${TOTALS_ROW}`).font = { bold: true };

  await workbook.xlsx.writeFile(OUTPUT);
  console.log(`Template sintetico gerado em ${OUTPUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
