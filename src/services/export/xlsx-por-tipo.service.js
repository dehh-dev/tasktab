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

// A paleta e a da planilha manual que este projeto substitui — azul de
// cabecalho, cinza de zebra. Nao e enfeite: quem confere ja conhece esse
// layout de cor, e chegar com outro obrigaria a reaprender onde olhar.
const NAVY = 'FF1F3864';
const WHITE = 'FFFFFFFF';
const ZEBRA = 'FFF2F2F2';
const SUBTLE = 'FF595959';

const THIN_BORDER = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};

// Colunas de uma aba de tipo, na ordem em que sao escritas. As larguras vieram
// da planilha de referencia, medidas com os nomes reais dos emitentes.
const COLUMNS = [
  { header: 'Data', width: 12, align: 'center' },
  { header: 'Local', width: 42 },
  { header: 'Cidade', width: 18 },
  { header: 'Hora', width: 10, align: 'center' },
  { header: 'Documento', width: 34 },
  { header: 'Valor (R$)', width: 15 },
];

const VALUE_COLUMN = 'F';

// Os que ficam de fora do somatorio, na ordem em que interessam a quem
// confere: primeiro o que ainda da trabalho, depois o que ja foi decidido.
const EXCLUDED_STATUSES = [
  'needs_review',
  'pending',
  'processing',
  'duplicate',
  'failed',
];

// Ordem das abas: a do enum, com "Sem categoria" no fim. Ordenar por valor
// faria dois relatorios da mesma pessoa saírem com layout diferente, e
// comparar um mes com o outro viraria procurar a linha toda vez.
const CATEGORY_ORDER = [...Object.keys(CATEGORY_LABELS), null];

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
 * `13:59:00` vira `13:59`. Os segundos vem do carimbo de autorizacao e nao
 * dizem nada a quem confere — ocupam coluna e nao respondem pergunta nenhuma.
 */
function formatTime(value) {
  if (!value) {
    return '';
  }
  return String(value).slice(0, 5);
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
 * quando o nome tem espaco ou acento (`'Sem categoria'!F2:F5`), e uma aspa
 * dentro do nome se escapa dobrando.
 */
function sheetRange(name, range) {
  return `'${name.replace(/'/g, "''")}'!${range}`;
}

function fill(color) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
}

/** Cabecalho de tabela: branco sobre azul, com borda e centralizado. */
function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, size: 10, color: { argb: WHITE } };
    cell.fill = fill(NAVY);
    cell.border = THIN_BORDER;
    cell.alignment = {
      horizontal: 'center',
      vertical: 'middle',
      wrapText: true,
    };
  });
  row.height = 22;
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

  sheet.addRow(COLUMNS.map((column) => column.header));
  styleHeaderRow(sheet.getRow(1));

  group.receipts.forEach((receipt, index) => {
    const row = sheet.getRow(2 + index);
    const striped = index % 2 === 1;

    row.getCell(1).value = receipt.issued_at
      ? excelSerialDate(receipt.issued_at)
      : null;
    row.getCell(1).numFmt = DATE_FORMAT;
    row.getCell(2).value = receipt.merchant_name || '';
    row.getCell(3).value = receipt.merchant_city || '';
    row.getCell(4).value = formatTime(receipt.issued_time);
    row.getCell(5).value = receipt.document_ref || '';
    row.getCell(6).value = (receipt.amount_cents ?? 0) / 100;
    row.getCell(6).numFmt = CURRENCY_FORMAT;

    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cell.font = { size: 10 };
      cell.border = THIN_BORDER;

      if (COLUMNS[column - 1]?.align) {
        cell.alignment = { horizontal: COLUMNS[column - 1].align };
      }

      // A zebra e o que permite seguir uma linha larga da data ate o valor sem
      // escorregar para a linha de cima. Cinza claro, e nao cor: a paleta do
      // projeto nao usa cor como unico canal de informacao.
      if (striped) {
        cell.fill = fill(ZEBRA);
      }
    });
  });

  const lastDataRow = 1 + group.receipts.length;
  const totalRow = lastDataRow + 1;
  const dataRange = `${VALUE_COLUMN}2:${VALUE_COLUMN}${lastDataRow}`;

  sheet.mergeCells(`A${totalRow}:E${totalRow}`);
  sheet.getCell(`A${totalRow}`).value = 'TOTAL';
  sheet.getCell(`${VALUE_COLUMN}${totalRow}`).value = {
    formula: `SUM(${dataRange})`,
  };
  sheet.getCell(`${VALUE_COLUMN}${totalRow}`).numFmt = CURRENCY_FORMAT;

  sheet.getRow(totalRow).eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true, size: 11, color: { argb: WHITE } };
    cell.fill = fill(NAVY);
    cell.border = THIN_BORDER;
  });
  sheet.getCell(`A${totalRow}`).alignment = {
    horizontal: 'right',
    vertical: 'middle',
  };

  COLUMNS.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width;
  });

  // O cabecalho fica visivel ao rolar, e o filtro deixa conferir um emitente
  // sem reordenar nada. Um lote de 30 cupons ja passa da altura da tela.
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: `${VALUE_COLUMN}${lastDataRow}` };

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
  sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: NAVY } };
  sheet.getCell('A2').value =
    `Periodo: ${formatDate(report.period_start)} a ${formatDate(report.period_end)}`;
  sheet.getCell('A2').font = { size: 10, color: { argb: SUBTLE } };

  sheet.getCell('A4').value = 'Resumo por tipo';
  sheet.getCell('A4').font = { bold: true, size: 11, color: { argb: NAVY } };

  const headerRow = 5;
  sheet.getRow(headerRow).values = ['Tipo', 'Qtd', 'Valor (R$)'];
  styleHeaderRow(sheet.getRow(headerRow));

  const firstDataRow = headerRow + 1;

  groups.forEach((group, index) => {
    const row = sheet.getRow(firstDataRow + index);

    row.getCell(1).value = group.label;
    row.getCell(2).value = group.receipts.length;
    row.getCell(3).value = {
      formula: `SUM(${sheetRange(group.sheet.name, group.sheet.dataRange)})`,
    };
    row.getCell(3).numFmt = CURRENCY_FORMAT;

    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cell.font = { size: 10 };
      cell.border = THIN_BORDER;

      if (column === 2) {
        cell.alignment = { horizontal: 'center' };
      }
      if (index % 2 === 1) {
        cell.fill = fill(ZEBRA);
      }
    });
  });

  const lastDataRow = firstDataRow + groups.length - 1;
  const totalRow = groups.length > 0 ? lastDataRow + 1 : firstDataRow;

  sheet.getCell(`A${totalRow}`).value = 'TOTAL';

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

  sheet.getRow(totalRow).eachCell({ includeEmpty: true }, (cell, column) => {
    cell.font = { bold: true, size: 11, color: { argb: WHITE } };
    cell.fill = fill(NAVY);
    cell.border = THIN_BORDER;

    if (column === 2) {
      cell.alignment = { horizontal: 'center' };
    }
  });

  // O que nao entrou fica listado, contado e fora de qualquer soma. Uma
  // planilha que so mostra o confirmado esconde justamente o trabalho que
  // falta — e quem assina descobriria a lacuna depois de assinar.
  if (excluded.length > 0) {
    let row = totalRow + 2;
    sheet.getCell(`A${row}`).value = 'Fora da prestação';
    sheet.getCell(`A${row}`).font = {
      bold: true,
      size: 11,
      color: { argb: NAVY },
    };

    for (const item of excluded) {
      row += 1;
      sheet.getCell(`A${row}`).value = item.label;
      sheet.getCell(`B${row}`).value = item.count;
      sheet.getCell(`C${row}`).value = item.cents / 100;
      sheet.getCell(`C${row}`).numFmt = CURRENCY_FORMAT;

      sheet.getRow(row).eachCell({ includeEmpty: true }, (cell, column) => {
        cell.font = { size: 10, color: { argb: SUBTLE } };
        cell.border = THIN_BORDER;

        if (column === 2) {
          cell.alignment = { horizontal: 'center' };
        }
      });
    }
  }

  sheet.getColumn(1).width = 30;
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
  VALUE_COLUMN,
};
