'use strict';

/**
 * Avaliador minimo de `SUM(...)` sobre um workbook ja carregado.
 *
 * Existe porque o exceljs grava a formula mas nao a calcula: sem resolver o
 * intervalo, um teste so consegue afirmar que a string da formula e a que se
 * esperava — e foi exatamente esse o buraco por onde passou um subtotal que
 * apontava para um rotulo que nenhuma linha usava. Aqui o intervalo e lido
 * celula a celula, entao o teste falha quando a formula aponta para o lugar
 * errado, mesmo que o texto dela pareca certo.
 *
 * Cobre so o que as exportacoes usam: `SUM(A1:A9)` e `SUM('Aba'!A1:A9)`.
 */

const SUM_PATTERN =
  /^SUM\((?:'((?:[^']|'')+)'!)?([A-Z]+)(\d+):([A-Z]+)(\d+)\)$/;

function columnToNumber(letters) {
  return [...letters].reduce(
    (total, letter) => total * 26 + (letter.charCodeAt(0) - 64),
    0,
  );
}

/** Resolve `SUM(...)` da celula indicada e devolve a soma dos valores. */
function evaluateSum(workbook, sheetName, address) {
  const cell = workbook.getWorksheet(sheetName).getCell(address);
  const formula = cell.value && cell.value.formula;

  if (!formula) {
    throw new Error(`${sheetName}!${address} nao contem formula`);
  }

  const match = SUM_PATTERN.exec(formula);

  if (!match) {
    throw new Error(`formula fora do suportado pelo helper: ${formula}`);
  }

  const [, quotedSheet, startColumn, startRow, endColumn, endRow] = match;
  const target = quotedSheet
    ? workbook.getWorksheet(quotedSheet.replace(/''/g, "'"))
    : workbook.getWorksheet(sheetName);

  if (!target) {
    throw new Error(`a formula referencia uma aba inexistente: ${formula}`);
  }

  let total = 0;

  for (let row = Number(startRow); row <= Number(endRow); row += 1) {
    for (
      let column = columnToNumber(startColumn);
      column <= columnToNumber(endColumn);
      column += 1
    ) {
      const value = target.getRow(row).getCell(column).value;

      if (typeof value === 'number') {
        total += value;
      } else if (value && typeof value.formula === 'string') {
        total += evaluateSum(
          workbook,
          target.name,
          target.getRow(row).getCell(column).address,
        );
      }
    }
  }

  // Somar reais em float traz 89.60000000000001 do mesmo jeito que trouxe no
  // caso que originou o projeto — aqui a resposta e so para comparacao.
  return Math.round(total * 100) / 100;
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

module.exports = { evaluateSum, findRow };
