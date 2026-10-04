'use strict';

const fs = require('fs/promises');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const env = require('../../config/env');
const { ValidationError } = require('../../../infra/errors');

/** "do comprovante 3", "dos comprovantes 3, 5 e 7". */
function receiptList(ids) {
  if (ids.length === 1) {
    return `do comprovante ${ids[0]}`;
  }

  return `dos comprovantes ${ids.slice(0, -1).join(', ')} e ${ids.at(-1)}`;
}

/**
 * Os arquivos originais dos comprovantes, cada um aberto uma vez.
 *
 * Arquivo fora do disco e PDF que o pdf-lib recusa nao param a abertura no
 * primeiro: voltam todos, com os comprovantes de cada um, para quem chama
 * dizer de uma vez o que falta. Parar no primeiro custava uma volta por
 * arquivo, e um PDF que nao abre derrubava a checagem final com 500.
 */
async function openOriginals(receipts) {
  const sources = new Map();
  const missing = [];
  const unreadable = [];

  for (const filePath of new Set(
    receipts.map((receipt) => receipt.file_path),
  )) {
    const ids = receipts
      .filter((receipt) => receipt.file_path === filePath)
      .map((receipt) => receipt.id);
    let bytes;

    try {
      bytes = await fs.readFile(path.join(env.upload.dir, filePath));
    } catch (error) {
      // Outra falha de leitura (permissao, disco) e do servidor, e estoura.
      if (error.code !== 'ENOENT') {
        throw error;
      }

      missing.push(...ids);
      continue;
    }

    try {
      const source = await PDFDocument.load(bytes);

      // O `load` e tolerante: aceita arquivo sem catalogo e so falha ao
      // chegar nas paginas. Contar as paginas e o mesmo teste do upload
      // (`pdf.service.js`) para dizer que o PDF abre.
      source.getPageCount();
      sources.set(filePath, source);
    } catch {
      // E o PDF protegido ou corrompido que o upload guarda como `failed`. O
      // pdf-lib nao tem classe comum para isso — o mesmo arquivo cai como
      // TypeError ou como Error —, entao vale o que vier dessas duas
      // chamadas, e so delas.
      unreadable.push(...ids);
    }
  }

  const ascending = (a, b) => a - b;

  return {
    sources,
    missing: missing.sort(ascending),
    unreadable: unreadable.sort(ascending),
  };
}

/** Se faltou alguma pagina ao abrir os originais. */
function hasProblems({ missing, unreadable }) {
  return missing.length > 0 || unreadable.length > 0;
}

/**
 * O que faltou, numa frase: "O arquivo do comprovante 3 nao esta no disco, e
 * os PDFs dos comprovantes 5 e 7 nao abrem".
 */
function describeProblems({ missing, unreadable }) {
  const parts = [];

  if (missing.length === 1) {
    parts.push(`o arquivo ${receiptList(missing)} nao esta no disco`);
  } else if (missing.length > 1) {
    parts.push(`os arquivos ${receiptList(missing)} nao estao no disco`);
  }

  if (unreadable.length === 1) {
    parts.push(`o PDF ${receiptList(unreadable)} nao abre`);
  } else if (unreadable.length > 1) {
    parts.push(`os PDFs ${receiptList(unreadable)} nao abrem`);
  }

  const sentence = parts.join(', e ');

  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`;
}

/** O que fazer com cada tipo de falta. */
function problemsAction({ missing, unreadable }) {
  const actions = [];

  if (missing.length > 0) {
    actions.push(
      'Envie de novo o PDF original do que nao esta no disco: o arquivo volta para o lugar.',
    );
  }

  if (unreadable.length > 0) {
    actions.push(
      'Remova o comprovante cujo PDF nao abre e envie um que abra, sem senha.',
    );
  }

  return actions.join(' ');
}

/**
 * 422 quando uma saida nao pode levar todas as paginas: um PDF consolidado ou
 * um ZIP sem elas pareceria completo. `output` nomeia a saida na mensagem.
 */
function assertAllOpen(opened, output) {
  if (!hasProblems(opened)) {
    return;
  }

  throw new ValidationError({
    message: `${describeProblems(opened)}: ${output} nao sai sem todas as paginas.`,
    action: problemsAction(opened),
    details: [
      ...opened.missing.map((id) => ({
        field: 'receipts',
        message: `comprovante ${id}: arquivo fora do disco`,
      })),
      ...opened.unreadable.map((id) => ({
        field: 'receipts',
        message: `comprovante ${id}: PDF que nao abre`,
      })),
    ],
  });
}

module.exports = {
  openOriginals,
  hasProblems,
  describeProblems,
  assertAllOpen,
};
