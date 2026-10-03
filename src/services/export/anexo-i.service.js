'use strict';

const fs = require('fs/promises');
const path = require('path');
const JSZip = require('jszip');
const { setCell, ensureFullCalcOnLoad } = require('./xlsx-cell-patch');
const { categoryLabel } = require('./labels');
const { ValidationError } = require('../../../infra/errors');

const SHEET_PATH = 'xl/worksheets/sheet1.xml';

/**
 * **Este template e SINTETICO, nao o formulario oficial.** Nao existe, neste
 * projeto, o arquivo real do Anexo I — decisao tomada com o usuario ao
 * iniciar o M6. Gerado por `scripts/generate-anexo-i-template.js`, reproduz a
 * mesma estrutura que o backlog descreve (formulas, celula mesclada, lista
 * suspensa, linha de totais cobrindo o intervalo inteiro) para provar a
 * tecnica de remendo. Troque por `assets/anexo-i-template.xlsx` de verdade
 * antes de qualquer uso real, e confira se o mapa de colunas abaixo continua
 * batendo com o formulario oficial.
 */
const TEMPLATE_PATH = path.resolve(
  __dirname,
  '../../../assets/anexo-i-template.xlsx',
);

const FIRST_DATA_ROW = 32;
const LAST_DATA_ROW = 100;
const MAX_ROWS = LAST_DATA_ROW - FIRST_DATA_ROW + 1;

/**
 * Coluna de valor de cada categoria, no mapa do formulario versao 19 descrito
 * pelo procedimento de prestacao de contas: O Passagens, Q Taxi/Conducoes,
 * S Alimentacao, U Hospedagem, W Combustivel, X Outras.
 *
 * Lavanderia nao tem coluna propria e cai em X — o que o procedimento registra
 * como certo, e nao como erro de classificacao. Estacionamento tambem caia, e
 * desde a Issue 40 ja chega classificado como Outros. Ate a Issue 38 o mapa
 * era placeholder e mandava `transporte` para W: uma corrida de taxi saia
 * lancada como abastecimento. Confira o mapa de novo quando o formulario
 * oficial substituir o template sintetico.
 */
const CATEGORY_COLUMN = {
  alimentacao: 'S',
  combustivel: 'W',
  transporte: 'Q',
  lavanderia: 'X',
  outros: 'X',
  nao_classificado: 'X',
};

function excelSerialDate(isoDate) {
  const epoch = Date.UTC(1899, 11, 30);
  const [year, month, day] = isoDate.split('-').map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - epoch) / 86400000);
}

function describeLine(receipt) {
  const merchant = receipt.merchant_name || 'Emitente nao identificado';
  return `${merchant} - ${categoryLabel(receipt.category)}`;
}

/**
 * Preenche o Anexo I remendando o template, sem reconstrui-lo.
 *
 * So entram comprovantes `confirmed`: e o unico status que significa "revisado
 * por uma pessoa e pronto para a prestacao de contas oficial". O relatorio-
 * resumo (Issue 16) mostra tudo; este documento e o que vai assinado.
 */
async function fillAnexoI(report, receipts) {
  const confirmed = receipts.filter(
    (receipt) => receipt.status === 'confirmed',
  );

  if (confirmed.length > MAX_ROWS) {
    throw new ValidationError({
      message: `O template do Anexo I tem espaco para ${MAX_ROWS} lancamentos, e este relatorio tem ${confirmed.length}.`,
      action: 'Divida a prestacao de contas em mais de um relatorio.',
      details: [
        { field: 'receipts', message: 'excede o numero de linhas do template' },
      ],
    });
  }

  // Sem catch: template ausente e defeito de instalacao, nao do relatorio.
  // Como 422 mandava quem usa corrigir um campo que nao existe, e sem a causa
  // o log nao dizia qual arquivo faltava.
  const templateBuffer = await fs.readFile(TEMPLATE_PATH);

  const zip = await JSZip.loadAsync(templateBuffer);
  let sheetXml = await zip.file(SHEET_PATH).async('string');

  confirmed.forEach((receipt, index) => {
    const row = FIRST_DATA_ROW + index;
    const column = CATEGORY_COLUMN[receipt.category] || 'X';

    if (receipt.issued_at) {
      sheetXml = setCell(sheetXml, `B${row}`, {
        type: 'number',
        value: excelSerialDate(receipt.issued_at),
      });
    }

    sheetXml = setCell(sheetXml, `C${row}`, {
      type: 'string',
      value: receipt.merchant_city || '',
    });
    sheetXml = setCell(sheetXml, `G${row}`, {
      type: 'string',
      value: describeLine(receipt),
    });
    sheetXml = setCell(sheetXml, `${column}${row}`, {
      type: 'number',
      value: (receipt.amount_cents ?? 0) / 100,
    });
  });

  sheetXml = setCell(sheetXml, 'C3', {
    type: 'number',
    value: (report.advance_cents ?? 0) / 100,
  });

  zip.file(SHEET_PATH, sheetXml);

  let workbookXml = await zip.file('xl/workbook.xml').async('string');
  workbookXml = ensureFullCalcOnLoad(workbookXml);
  zip.file('xl/workbook.xml', workbookXml);

  return zip.generateAsync({ type: 'nodebuffer' });
}

module.exports = {
  fillAnexoI,
  TEMPLATE_PATH,
  FIRST_DATA_ROW,
  LAST_DATA_ROW,
  MAX_ROWS,
  CATEGORY_COLUMN,
};
