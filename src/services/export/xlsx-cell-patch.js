'use strict';

/**
 * Remendo cirurgico de celulas num `sheetN.xml` de planilha `.xlsx`.
 *
 * O motivo de existir: bibliotecas que abrem e regravam um `.xlsx` reconstroem
 * o XML inteiro a partir do modelo em memoria, e perdem o que nao sabem
 * representar. Na conferencia manual que originou este projeto, a validacao
 * de dados (lista suspensa) de um template oficial se perdeu exatamente
 * assim, ao passar por uma biblioteca de leitura-e-escrita.
 *
 * Aqui a estrategia e outra: **nunca desmontar o arquivo**. Cada celula de
 * dado e substituida por manipulacao de string, direto no texto do XML, sem
 * passar por um parser/serializer completo. Tudo o que este modulo nao toca
 * — estilos, formulas, `dataValidations`, `mergeCells` — sobrevive
 * byte a byte, porque nunca foi lido para a memoria como objeto.
 */

function escapeXmlText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function columnLetters(ref) {
  return ref.match(/^[A-Z]+/)[0];
}

/** Compara duas referencias de coluna (`"B"` < `"G"` < `"AA"`). */
function compareColumns(a, b) {
  if (a.length !== b.length) {
    return a.length - b.length;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

function buildCellXml(ref, styleAttr, field) {
  if (field.type === 'string') {
    return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(field.value)}</t></is></c>`;
  }
  // Numero ou data (a data ja chega convertida em serial do Excel — o `s`
  // preservado e quem decide como ela e exibida).
  return `<c r="${ref}"${styleAttr}><v>${field.value}</v></c>`;
}

/**
 * Insere uma celula nova dentro do corpo de uma `<row>`, respeitando a ordem
 * de colunas — o OOXML espera `<c>` em ordem ascendente dentro da linha.
 */
function insertInOrder(rowBody, ref, cellXml) {
  const targetColumn = columnLetters(ref);
  const cellPattern = /<c r="([A-Z]+\d+)"/g;
  let match;
  let insertAt = rowBody.length;

  while ((match = cellPattern.exec(rowBody))) {
    if (compareColumns(columnLetters(match[1]), targetColumn) > 0) {
      insertAt = match.index;
      break;
    }
  }

  return rowBody.slice(0, insertAt) + cellXml + rowBody.slice(insertAt);
}

/**
 * Substitui (ou cria) uma celula de dado numa linha existente do sheet.
 *
 * `field` e `{ type: 'string' | 'number', value }`. O estilo (`s="..."`) da
 * celula, se ja existia, e preservado — e o que garante que a formatacao de
 * moeda ou de data do template continue valendo.
 *
 * Lanca erro se a linha (`<row r="N">`) nao existir no template: preencher
 * uma linha que o formulario nao tem seria inventar estrutura, nao remendar.
 */
function setCell(sheetXml, ref, field) {
  const rowNumber = ref.match(/\d+$/)[0];
  const rowPattern = new RegExp(
    `(<row r="${rowNumber}"[^>]*>)([\\s\\S]*?)(</row>)`,
  );
  const rowMatch = sheetXml.match(rowPattern);

  if (!rowMatch) {
    throw new Error(
      `Linha ${rowNumber} nao existe no template — nada para remendar.`,
    );
  }

  const [full, openTag, body, closeTag] = rowMatch;
  // Os atributos precisam ser capturados de forma preguicosa (`*?`). Guloso
  // (`*`) consome o `/` de uma celula autofechada (`<c .../>`) junto com os
  // atributos, e a alternativa `/>` deixa de casar — o regex entao cai no
  // ramo `>...</c>` e engole a CELULA SEGUINTE inteira como se fosse
  // conteudo desta, apagando-a ao substituir. Foi assim que uma celula sem
  // valor (`<c r="B32" s="3"/>`) apagou a `S32` logo depois dela.
  const cellPattern = new RegExp(
    `<c r="${ref}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`,
  );
  const cellMatch = body.match(cellPattern);

  let styleAttr = '';
  if (cellMatch) {
    const style = cellMatch[1].match(/\ss="(\d+)"/);
    if (style) {
      styleAttr = ` s="${style[1]}"`;
    }
  }

  const cellXml = buildCellXml(ref, styleAttr, field);
  const newBody = cellMatch
    ? body.slice(0, cellMatch.index) +
      cellXml +
      body.slice(cellMatch.index + cellMatch[0].length)
    : insertInOrder(body, ref, cellXml);

  const start = rowMatch.index;
  return (
    sheetXml.slice(0, start) +
    openTag +
    newBody +
    closeTag +
    sheetXml.slice(start + full.length)
  );
}

/**
 * Forca o Excel a recalcular ao abrir, em vez de exibir o valor em cache das
 * formulas ate alguem editar uma celula. Sem isso, um total preenchido por
 * este remendo apareceria com o valor antigo (zero, no template em branco)
 * ate o usuario mexer em algo.
 *
 * So mexe no atributo se `<calcPr>` ja existir no workbook — e o caso normal
 * de um `.xlsx` gerado por Excel de verdade. Se nao existir, nao inventa a
 * tag: a posicao dela no XML segue uma ordem de elementos que nao vale a pena
 * arriscar adivinhar.
 */
function ensureFullCalcOnLoad(workbookXml) {
  const match = workbookXml.match(/<calcPr\b[^>]*\/>/);

  if (!match) {
    return workbookXml;
  }

  if (/fullCalcOnLoad="1"/.test(match[0])) {
    return workbookXml;
  }

  const patched = match[0].replace('<calcPr', '<calcPr fullCalcOnLoad="1"');
  return workbookXml.replace(match[0], patched);
}

module.exports = { setCell, ensureFullCalcOnLoad, escapeXmlText };
