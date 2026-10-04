'use strict';

const ExcelJS = require('exceljs');
const accessKey = require('../extraction/access-key');
const { LEVELS } = require('../validation');
const {
  CATEGORY_LABELS,
  categoryKey,
  categoryLabel,
  levelLabel,
  statusLabel,
} = require('./labels');

// `[$R$-416]` e o codigo de moeda pt-BR do Excel. `"R$" #,##0.00` parece
// equivalente, mas nao e: sem o locale, o separador de milhar/decimal segue o
// locale de quem abrir o arquivo, e em en-US 1.320,28 vira 1,320.28.
const CURRENCY_FORMAT = '[$R$-416] #,##0.00';
const DATE_FORMAT = 'DD/MM/YYYY';

const EXPENSES_SHEET = 'Despesas';
const SUMMARY_SHEET = 'Resumo';
const NOTES_SHEET = 'Observações';

// A paleta e a da planilha manual que este projeto substitui — azul de
// cabecalho, cinza de zebra. Nao e enfeite: quem confere ja conhece esse
// layout de cor, e chegar com outro obrigaria a reaprender onde olhar.
const NAVY = 'FF1F3864';
const WHITE = 'FFFFFFFF';
const ZEBRA = 'FFF2F2F2';
const SUBTLE = 'FF595959';

// A linha que pede atencao ganha cor, e a classe vai escrita na coluna
// Conferencia: a cor ajuda a achar, o texto e quem diz. Amarelo para o que
// falta ou pede decisao, laranja para o que provavelmente esta errado — as
// mesmas da tela.
const LEVEL_FILL = {
  pendente: 'FFFFF2CC',
  decisao: 'FFFFF2CC',
  atencao: 'FFFCE4D6',
};

// A classe que a linha mostra quando o comprovante tem mais de uma: o que
// provavelmente esta errado na frente do que so pede decisao.
const ROW_LEVEL_ORDER = [
  'atencao',
  'pendente',
  'decisao',
  'informativo',
  'verificado',
];

const THIN_BORDER = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};

// As cinco colunas do procedimento, na ordem dele, e as de apoio depois. A
// letra de cada uma e fixa: o Resumo inteiro e formula sobre elas.
const EXPENSE_COLUMNS = [
  { header: 'Data', width: 12, align: 'center' },
  { header: 'Local', width: 44 },
  { header: 'Cidade', width: 20 },
  { header: 'Tipo', width: 18 },
  { header: 'Valor', width: 16 },
  { header: 'Documento', width: 13, align: 'center' },
  { header: 'Conferência', width: 14, align: 'center' },
];
const CITY_COLUMN = 'C';
const TYPE_COLUMN = 'D';
const AMOUNT_COLUMN = 'E';
const DOCUMENT_COLUMN = 'F';
const LAST_EXPENSE_COLUMN = 'G';

// Sem chave de acesso valida o documento nao e fiscal (issue 50): recibo,
// comanda e cupom de conferencia podem ser glosados.
const WITH_KEY = 'Com chave';
const WITHOUT_KEY = 'Sem chave';

const NO_CITY_LABEL = 'Sem cidade';

// Colunas de uma aba de tipo (issue 29). As larguras vieram da planilha de
// referencia, medidas com os nomes reais dos emitentes.
const CATEGORY_COLUMNS = [
  { header: 'Data', width: 12, align: 'center' },
  { header: 'Local', width: 44 },
  { header: 'Cidade', width: 20 },
  { header: 'Valor (R$)', width: 16 },
];

const VALUE_COLUMN = 'D';

// Os que ficam de fora do somatorio, na ordem em que interessam a quem
// confere: primeiro o que ainda da trabalho, depois o que ja foi decidido.
const EXCLUDED_STATUSES = [
  'needs_review',
  'pending',
  'processing',
  'duplicate',
  'failed',
];

// Ordem dos tipos: a do enum, com "Sem categoria" no fim. Ordenar por valor
// faria dois relatorios da mesma pessoa sairem com layout diferente, e
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

/** Uma coluna inteira dos dados da aba Despesas, fixa para a formula. */
function expensesColumn(column, lastRow) {
  return sheetRange(EXPENSES_SHEET, `$${column}$2:$${column}$${lastRow}`);
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

/** Linha de total: branco sobre azul, em negrito, ate a ultima coluna. */
function styleTotalRow(row, columnCount) {
  for (let column = 1; column <= columnCount; column += 1) {
    const cell = row.getCell(column);

    cell.font = { bold: true, size: 11, color: { argb: WHITE } };
    cell.fill = fill(NAVY);
    cell.border = THIN_BORDER;
  }
}

/** Titulo de um bloco do Resumo. */
function styleTitle(cell) {
  cell.font = { bold: true, size: 11, color: { argb: NAVY } };
}

/**
 * Linha de dado: fonte, borda e alinhamento de cada coluna, com a cor da
 * classe quando ha, ou a zebra. A zebra e o que permite seguir uma linha
 * larga da data ate o valor sem escorregar para a linha de cima — cinza
 * claro, e nao cor.
 */
function styleDataRow(row, columns, { index, color }) {
  columns.forEach((column, position) => {
    const cell = row.getCell(position + 1);

    cell.font = { size: 10 };
    cell.border = THIN_BORDER;

    if (column.align) {
      cell.alignment = { horizontal: column.align };
    }
    if (color) {
      cell.fill = fill(color);
    } else if (index % 2 === 1) {
      cell.fill = fill(ZEBRA);
    }
  });
}

function sumCents(receipts) {
  return receipts.reduce(
    (total, receipt) => total + (receipt.amount_cents ?? 0),
    0,
  );
}

/**
 * Formula com o resultado ja guardado.
 *
 * O exceljs grava a formula sem valor, e o Excel recalcula ao abrir — mas a
 * pre-visualizacao do WhatsApp, do Gmail e do Drive, e qualquer leitor que use
 * o valor guardado, mostravam os totais em branco. O resultado sai dos
 * centavos inteiros, a mesma conta da formula, e o `fullCalcOnLoad` do
 * workbook faz quem recalcula refazer a conta de qualquer jeito.
 */
function formulaWithResult(formula, result) {
  return { formula, result };
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

/**
 * A classe que cada comprovante mostra na linha: a mais grave entre os
 * alertas dele, pela ordem de `ROW_LEVEL_ORDER`.
 */
function rowLevels(alerts) {
  const levels = new Map();

  for (const alert of alerts) {
    const current = levels.get(alert.receipt_id);

    if (
      alert.receipt_id &&
      (current === undefined ||
        ROW_LEVEL_ORDER.indexOf(alert.level) < ROW_LEVEL_ORDER.indexOf(current))
    ) {
      levels.set(alert.receipt_id, alert.level);
    }
  }

  return levels;
}

/** Uma linha da aba Despesas, ja com o texto de cada coluna. */
function expenseRow(receipt, level) {
  return {
    date: receipt.issued_at,
    local: (receipt.merchant_name ?? '').trim(),
    city: (receipt.merchant_city ?? '').trim(),
    type: categoryLabel(receipt.category),
    cents: receipt.amount_cents ?? 0,
    document: accessKey.isValid(receipt.access_key) ? WITH_KEY : WITHOUT_KEY,
    level,
  };
}

/**
 * A aba principal, no formato do procedimento: um comprovante confirmado por
 * linha, em ordem cronologica, e o TOTAL GERAL. O Resumo inteiro sai dela por
 * formula, entao corrigir uma linha aqui corrige o resto.
 */
function addExpensesSheet(workbook, rows) {
  const sheet = workbook.addWorksheet(EXPENSES_SHEET);

  sheet.addRow(EXPENSE_COLUMNS.map((column) => column.header));
  styleHeaderRow(sheet.getRow(1));

  rows.forEach((item, index) => {
    const row = sheet.getRow(2 + index);

    row.values = [
      item.date ? excelSerialDate(item.date) : null,
      item.local,
      item.city,
      item.type,
      item.cents / 100,
      item.document,
      item.level ? levelLabel(item.level) : '',
    ];
    row.getCell(1).numFmt = DATE_FORMAT;
    row.getCell(5).numFmt = CURRENCY_FORMAT;

    styleDataRow(row, EXPENSE_COLUMNS, {
      index,
      color: LEVEL_FILL[item.level],
    });
  });

  const lastRow = 1 + rows.length;
  const totalRow = lastRow + 1;

  sheet.mergeCells(`A${totalRow}:D${totalRow}`);
  sheet.getCell(`A${totalRow}`).value = 'TOTAL GERAL';
  // Sem nenhuma linha, nao ha intervalo para somar: zero literal.
  sheet.getCell(`${AMOUNT_COLUMN}${totalRow}`).value =
    rows.length > 0
      ? formulaWithResult(
          `SUM(${AMOUNT_COLUMN}2:${AMOUNT_COLUMN}${lastRow})`,
          rows.reduce((total, item) => total + item.cents, 0) / 100,
        )
      : 0;
  sheet.getCell(`${AMOUNT_COLUMN}${totalRow}`).numFmt = CURRENCY_FORMAT;
  styleTotalRow(sheet.getRow(totalRow), EXPENSE_COLUMNS.length);
  sheet.getCell(`A${totalRow}`).alignment = {
    horizontal: 'right',
    vertical: 'middle',
  };

  EXPENSE_COLUMNS.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width;
  });

  // O cabecalho fica visivel ao rolar, e o filtro deixa conferir um tipo ou
  // uma cidade sem reordenar nada. Impressa, a aba cabe na largura da folha
  // deitada, e o cabecalho se repete em cada pagina.
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: `${LAST_EXPENSE_COLUMN}${lastRow}` };
  sheet.pageSetup = {
    orientation: 'landscape',
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: '1:1',
  };

  return { lastRow, totalRow };
}

/**
 * Grupos de uma tabela do Resumo, cada um com o criterio do COUNTIF: o
 * rotulo da propria linha, ou "" para o grupo das celulas vazias.
 */
function typeGroups(rows) {
  return CATEGORY_ORDER.map((key) => categoryLabel(key))
    .map((label) => ({
      label,
      rows: rows.filter((item) => item.type === label),
    }))
    .filter((group) => group.rows.length > 0);
}

function cityGroups(rows) {
  const groups = new Map();

  for (const item of rows) {
    // O COUNTIF do Excel nao distingue caixa: "ITAPIPOCA/CE" e
    // "Itapipoca/CE" caem no mesmo criterio, e duas linhas para eles
    // somariam a mesma despesa duas vezes.
    const key = item.city.toLocaleLowerCase('pt-BR');

    if (!groups.has(key)) {
      groups.set(key, {
        label: item.city || NO_CITY_LABEL,
        blank: !item.city,
        rows: [],
      });
    }

    groups.get(key).rows.push(item);
  }

  return [...groups.values()].sort(
    (a, b) => a.blank - b.blank || a.label.localeCompare(b.label, 'pt-BR'),
  );
}

function documentGroups(rows) {
  return [WITH_KEY, WITHOUT_KEY].map((label) => ({
    label,
    rows: rows.filter((item) => item.document === label),
  }));
}

/**
 * Uma tabela do Resumo: titulo, cabecalho, um grupo por linha com
 * quantidade e valor por `COUNTIF`/`SUMIF` sobre a coluna de Despesas, e o
 * total. Devolve a linha do total e a proxima livre.
 */
function addGroupTable(sheet, startRow, table) {
  const { title, header, groups, column, expenses } = table;

  sheet.getCell(`A${startRow}`).value = title;
  styleTitle(sheet.getCell(`A${startRow}`));

  const headerRow = startRow + 1;
  sheet.getRow(headerRow).values = [header, 'Qtd.', 'Valor'];
  styleHeaderRow(sheet.getRow(headerRow));

  const criteria = expensesColumn(column, expenses.lastRow);
  const amounts = expensesColumn(AMOUNT_COLUMN, expenses.lastRow);
  const hasRows = expenses.lastRow > 1;

  groups.forEach((group, index) => {
    const number = headerRow + 1 + index;
    const row = sheet.getRow(number);
    const criterion = group.blank ? '""' : `A${number}`;
    const cents = group.rows.reduce((total, item) => total + item.cents, 0);

    row.getCell(1).value = group.label;
    row.getCell(2).value = hasRows
      ? formulaWithResult(
          `COUNTIF(${criteria},${criterion})`,
          group.rows.length,
        )
      : 0;
    row.getCell(3).value = hasRows
      ? formulaWithResult(
          `SUMIF(${criteria},${criterion},${amounts})`,
          cents / 100,
        )
      : 0;
    row.getCell(3).numFmt = CURRENCY_FORMAT;

    styleDataRow(row, [{}, { align: 'center' }, {}], { index });
  });

  const totalRow = headerRow + 1 + groups.length;
  const all = groups.flatMap((group) => group.rows);

  sheet.getCell(`A${totalRow}`).value = 'Total';
  // Sem nenhum grupo, nao ha intervalo para somar: uma formula sobre um
  // intervalo vazio abriria com #REF! na cara de quem so quer ver o zero.
  sheet.getCell(`B${totalRow}`).value =
    groups.length > 0
      ? formulaWithResult(`SUM(B${headerRow + 1}:B${totalRow - 1})`, all.length)
      : 0;
  sheet.getCell(`C${totalRow}`).value =
    groups.length > 0
      ? formulaWithResult(
          `SUM(C${headerRow + 1}:C${totalRow - 1})`,
          all.reduce((total, item) => total + item.cents, 0) / 100,
        )
      : 0;
  sheet.getCell(`C${totalRow}`).numFmt = CURRENCY_FORMAT;
  styleTotalRow(sheet.getRow(totalRow), 3);
  sheet.getCell(`B${totalRow}`).alignment = { horizontal: 'center' };

  return { totalRow, nextRow: totalRow + 2 };
}

/** Uma linha "rotulo ... valor" de bloco do Resumo, com o valor na coluna C. */
function addLine(sheet, number, label, value, { currency = true } = {}) {
  sheet.getCell(`A${number}`).value = label;
  sheet.getCell(`C${number}`).value = value;

  if (currency) {
    sheet.getCell(`C${number}`).numFmt = CURRENCY_FORMAT;
  }

  for (const column of ['A', 'B', 'C']) {
    sheet.getCell(`${column}${number}`).font = { size: 10 };
    sheet.getCell(`${column}${number}`).border = THIN_BORDER;
  }
}

/**
 * As somas do bloco de conferencia em centavos, pelos mesmos grupos que as
 * tabelas do Resumo usam. A planilha guarda estes resultados, e a checagem
 * final (issue 57) confere os mesmos numeros antes de o relatorio fechar.
 */
function conferenceTotals(receipts) {
  const rows = receipts
    .filter((receipt) => receipt.status === 'confirmed')
    .map((receipt) => expenseRow(receipt));
  const sum = (items) => items.reduce((total, item) => total + item.cents, 0);
  const sumGroups = (groups) =>
    groups.reduce((total, group) => total + sum(group.rows), 0);

  return {
    lines: sum(rows),
    byType: sumGroups(typeGroups(rows)),
    byCity: sumGroups(cityGroups(rows)),
  };
}

/**
 * O bloco de conferencia do procedimento: as quatro somas que precisam
 * bater — linhas, total geral, tipos e cidades — e a celula que diz se
 * batem. Geradas aqui, batem sempre; o bloco existe para quem edita a
 * planilha a mao: um tipo digitado sem acento sai do SUMIF do tipo, e a
 * celula vira DIVERGÊNCIA.
 */
function addCheckBlock(
  sheet,
  startRow,
  { expenses, typeTotalRow, cityTotalRow, totals },
) {
  sheet.getCell(`A${startRow}`).value = 'Conferência';
  styleTitle(sheet.getCell(`A${startRow}`));

  const sums = [
    [
      'Soma das linhas',
      expenses.lastRow > 1
        ? formulaWithResult(
            `SUM(${sheetRange(EXPENSES_SHEET, `${AMOUNT_COLUMN}2:${AMOUNT_COLUMN}${expenses.lastRow}`)})`,
            totals.lines / 100,
          )
        : 0,
    ],
    [
      'Total geral',
      formulaWithResult(
        sheetRange(EXPENSES_SHEET, `${AMOUNT_COLUMN}${expenses.totalRow}`),
        totals.lines / 100,
      ),
    ],
    [
      'Soma por tipo',
      formulaWithResult(`C${typeTotalRow}`, totals.byType / 100),
    ],
    [
      'Soma por cidade',
      formulaWithResult(`C${cityTotalRow}`, totals.byCity / 100),
    ],
  ];
  const agree =
    totals.lines === totals.byType && totals.lines === totals.byCity;

  sums.forEach(([label, value], index) => {
    addLine(sheet, startRow + 1 + index, label, value);
  });

  const first = startRow + 1;
  const resultRow = first + sums.length;
  // Cada soma contra a primeira, no centavo: somar reais em ponto flutuante
  // muda a decima casa sem ninguem ter errado nada.
  const equal = sums
    .map((_, index) => first + index)
    .slice(1)
    .map((row) => `ROUND(C${first},2)=ROUND(C${row},2)`)
    .join(',');

  addLine(
    sheet,
    resultRow,
    'Resultado',
    formulaWithResult(
      `IF(AND(${equal}),"OK","DIVERGÊNCIA")`,
      agree ? 'OK' : 'DIVERGÊNCIA',
    ),
    { currency: false },
  );
  sheet.getCell(`C${resultRow}`).font = { bold: true, size: 11 };
  sheet.getCell(`C${resultRow}`).alignment = { horizontal: 'center' };

  return { totalGeralRow: first + 1, nextRow: resultRow + 2 };
}

/**
 * Adiantamento e saldo. Nulo e "nao informado" (issue 44): sem ele nao ha
 * saldo, e a planilha diz isso em vez de tratar o nulo como zero. Zero e
 * "nao houve", e o saldo e o total inteiro a receber.
 */
function addBalanceBlock(sheet, startRow, { report, totalGeralRow, total }) {
  sheet.getCell(`A${startRow}`).value = 'Adiantamento e saldo';
  styleTitle(sheet.getCell(`A${startRow}`));

  const advanceRow = startRow + 1;
  const expensesRow = startRow + 2;
  const balanceRow = startRow + 3;
  const situationRow = startRow + 4;
  const advance = report.advance_cents;

  addLine(
    sheet,
    advanceRow,
    'Adiantamento',
    advance === null ? 'Não informado' : advance / 100,
    { currency: advance !== null },
  );
  addLine(
    sheet,
    expensesRow,
    'Despesas',
    formulaWithResult(`C${totalGeralRow}`, total / 100),
  );

  if (advance === null) {
    addLine(sheet, balanceRow, 'Saldo', '—', { currency: false });
    addLine(sheet, situationRow, 'Situação', 'Informe o adiantamento', {
      currency: false,
    });
    return { nextRow: situationRow + 2 };
  }

  const balance = advance - total;
  const situation =
    balance > 0 ? 'A devolver' : balance < 0 ? 'A receber' : 'Zerado';

  addLine(
    sheet,
    balanceRow,
    'Saldo',
    formulaWithResult(`ROUND(C${advanceRow}-C${expensesRow},2)`, balance / 100),
  );
  addLine(
    sheet,
    situationRow,
    'Situação',
    formulaWithResult(
      `IF(C${balanceRow}>0,"A devolver",IF(C${balanceRow}<0,"A receber","Zerado"))`,
      situation,
    ),
    { currency: false },
  );

  return { nextRow: situationRow + 2 };
}

/**
 * O que nao entrou fica listado, contado e fora de qualquer soma. Uma
 * planilha que so mostra o confirmado esconde justamente o trabalho que
 * falta — e quem assina descobriria a lacuna depois de assinar.
 */
function addExcludedBlock(sheet, startRow, excluded) {
  if (excluded.length === 0) {
    return;
  }

  sheet.getCell(`A${startRow}`).value = 'Fora da prestação';
  styleTitle(sheet.getCell(`A${startRow}`));

  excluded.forEach((item, index) => {
    const row = startRow + 1 + index;

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
  });
}

/**
 * O Resumo do procedimento, todo por formula sobre a aba Despesas: por tipo,
 * por cidade, a conferencia das somas, o saldo e os documentos sem chave
 * (issue 50).
 */
function fillSummarySheet(sheet, { report, rows, expenses, excluded, totals }) {
  sheet.getCell('A1').value = report.title;
  sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: NAVY } };
  sheet.getCell('A2').value =
    `Periodo: ${formatDate(report.period_start)} a ${formatDate(report.period_end)}`;
  sheet.getCell('A2').font = { size: 10, color: { argb: SUBTLE } };

  const types = addGroupTable(sheet, 4, {
    title: 'Resumo por tipo',
    header: 'Tipo',
    groups: typeGroups(rows),
    column: TYPE_COLUMN,
    expenses,
  });
  const cities = addGroupTable(sheet, types.nextRow, {
    title: 'Resumo por cidade',
    header: 'Cidade',
    groups: cityGroups(rows),
    column: CITY_COLUMN,
    expenses,
  });
  const check = addCheckBlock(sheet, cities.nextRow, {
    expenses,
    typeTotalRow: types.totalRow,
    cityTotalRow: cities.totalRow,
    totals,
  });
  const balance = addBalanceBlock(sheet, check.nextRow, {
    report,
    totalGeralRow: check.totalGeralRow,
    total: expenses.total,
  });
  const documents = addGroupTable(sheet, balance.nextRow, {
    title: 'Documentos',
    header: 'Documento',
    groups: documentGroups(rows),
    column: DOCUMENT_COLUMN,
    expenses,
  });

  addExcludedBlock(sheet, documents.nextRow, excluded);

  sheet.getColumn(1).width = 34;
  sheet.getColumn(2).width = 10;
  sheet.getColumn(3).width = 18;
  sheet.pageSetup = {
    orientation: 'portrait',
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };
}

/**
 * A conferencia do relatorio na classificacao do procedimento (issue 48):
 * uma linha por alerta, agrupada pela classe, com data, local e valor do
 * comprovante a que se refere. O texto e o da tela, entao as duas nunca
 * contam historias diferentes.
 */
function addNotesSheet(workbook, alerts, receipts) {
  const sheet = workbook.addWorksheet(NOTES_SHEET);
  const columns = [
    { header: 'Classe', width: 13, align: 'center' },
    { header: 'Data', width: 12, align: 'center' },
    { header: 'Local', width: 36 },
    { header: 'Valor', width: 14 },
    { header: 'Observação', width: 90 },
  ];
  const byId = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  const ordered = LEVELS.flatMap((level) =>
    alerts.filter((alert) => alert.level === level),
  );

  sheet.addRow(columns.map((column) => column.header));
  styleHeaderRow(sheet.getRow(1));

  ordered.forEach((alert, index) => {
    const receipt = byId.get(alert.receipt_id);
    const row = sheet.getRow(2 + index);

    row.values = [
      levelLabel(alert.level),
      receipt?.issued_at ? excelSerialDate(receipt.issued_at) : null,
      (receipt?.merchant_name ?? '').trim(),
      receipt && receipt.amount_cents !== null
        ? receipt.amount_cents / 100
        : null,
      alert.message,
    ];
    row.getCell(2).numFmt = DATE_FORMAT;
    row.getCell(4).numFmt = CURRENCY_FORMAT;

    styleDataRow(row, columns, { index, color: LEVEL_FILL[alert.level] });
    row.getCell(5).alignment = { wrapText: true, vertical: 'top' };
  });

  if (ordered.length === 0) {
    sheet.getCell('A2').value = 'Nenhuma observação da conferência.';
  }

  columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width;
  });

  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: `E${Math.max(1, ordered.length + 1)}` };
  sheet.pageSetup = {
    orientation: 'landscape',
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: '1:1',
  };
}

/** Uma aba por tipo: os lancamentos daquele tipo e o total da aba. */
function addCategorySheet(workbook, group) {
  const sheet = workbook.addWorksheet(sheetName(group.label));

  sheet.addRow(CATEGORY_COLUMNS.map((column) => column.header));
  styleHeaderRow(sheet.getRow(1));

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

    styleDataRow(row, CATEGORY_COLUMNS, { index });
  });

  const lastDataRow = 1 + group.receipts.length;
  const totalRow = lastDataRow + 1;
  const dataRange = `${VALUE_COLUMN}2:${VALUE_COLUMN}${lastDataRow}`;

  sheet.mergeCells(`A${totalRow}:C${totalRow}`);
  sheet.getCell(`A${totalRow}`).value = 'TOTAL';
  sheet.getCell(`${VALUE_COLUMN}${totalRow}`).value = formulaWithResult(
    `SUM(${dataRange})`,
    sumCents(group.receipts) / 100,
  );
  sheet.getCell(`${VALUE_COLUMN}${totalRow}`).numFmt = CURRENCY_FORMAT;
  styleTotalRow(sheet.getRow(totalRow), CATEGORY_COLUMNS.length);
  sheet.getCell(`A${totalRow}`).alignment = {
    horizontal: 'right',
    vertical: 'middle',
  };

  CATEGORY_COLUMNS.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width;
  });

  // O cabecalho fica visivel ao rolar, e o filtro deixa conferir um emitente
  // sem reordenar nada. Um lote de 30 cupons ja passa da altura da tela.
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: `${VALUE_COLUMN}${lastDataRow}` };
}

/**
 * A planilha do relatorio no formato do procedimento de prestacao de contas
 * (issue 53): Despesas, Resumo e Observacoes, e as abas por tipo da issue 29
 * ao lado.
 *
 * So entram comprovantes `confirmed` — o mesmo criterio do Anexo I, e o unico
 * status que significa "uma pessoa olhou e assinou embaixo". O resto vai
 * contado no "Fora da prestação". Os alertas sao os da conferencia do
 * relatorio inteiro (`validateReport`), inclusive os do que ainda nao foi
 * confirmado.
 */
async function buildWorkbook(report, receipts, alerts = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.calcProperties.fullCalcOnLoad = true;

  const confirmed = receipts.filter(
    (receipt) => receipt.status === 'confirmed',
  );
  const levels = rowLevels(alerts);
  const rows = confirmed.map((receipt) =>
    expenseRow(receipt, levels.get(receipt.id)),
  );

  const expenses = {
    ...addExpensesSheet(workbook, rows),
    total: rows.reduce((total, item) => total + item.cents, 0),
  };
  const summary = workbook.addWorksheet(SUMMARY_SHEET);
  addNotesSheet(workbook, alerts, receipts);

  for (const group of groupByCategory(confirmed)) {
    addCategorySheet(workbook, group);
  }

  const excluded = EXCLUDED_STATUSES.map((status) => {
    const matching = receipts.filter((receipt) => receipt.status === status);
    return {
      label: statusLabel(status),
      count: matching.length,
      cents: sumCents(matching),
    };
  }).filter((item) => item.count > 0);

  fillSummarySheet(summary, {
    report,
    rows,
    expenses,
    excluded,
    totals: conferenceTotals(receipts),
  });

  return workbook;
}

module.exports = { buildWorkbook, conferenceTotals };
