'use strict';

/**
 * Leitura do .csv das respostas do formulario.
 *
 * Nao e o `csv.read` do exceljs de proposito: o mapeamento padrao dele passa
 * cada valor por `Number()` e por um parser de data, e o CPF 012.345.678-90
 * digitado so com numeros vira 12345678900 — o zero a esquerda some antes de
 * qualquer validacao ver o dado. Aqui tudo sai como texto.
 *
 * Cobre o que os dois caminhos de download produzem: o Google Sheets (UTF-8,
 * virgula) e o Excel em portugues (Windows-1252, ponto e virgula). O titulo da
 * pergunta traz quebra de linha dentro das aspas ("Cidade-UF\n(Exemplo:
 * Goiania-GO)").
 */

const BOM = String.fromCharCode(0xfeff);

/** UTF-8 quando o arquivo e UTF-8 valido; senao, Windows-1252. */
function decodeText(buffer) {
  let text;

  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    // No padrao WHATWG, 'latin1' e o Windows-1252: e o que o Excel grava.
    text = new TextDecoder('latin1').decode(buffer);
  }

  return text.startsWith(BOM) ? text.slice(1) : text;
}

/** Virgula ou ponto e virgula, pelo que aparece mais na primeira linha. */
function detectDelimiter(text) {
  let inQuotes = false;
  let commas = 0;
  let semicolons = 0;

  for (const char of text) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (char === '\n' || char === '\r') break;
      if (char === ',') commas += 1;
      if (char === ';') semicolons += 1;
    }
  }

  return semicolons > commas ? ';' : ',';
}

/**
 * Linhas de celulas, todas texto. Aspas dobradas viram uma; quebra de linha
 * dentro de aspas fica no valor; CRLF e LF terminam a linha.
 */
function parseCsv(text, delimiter = detectDelimiter(text)) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char !== '"') {
        field += char;
      } else if (text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = false;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

module.exports = { decodeText, detectDelimiter, parseCsv };
