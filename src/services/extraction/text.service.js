'use strict';

const { extractText, getDocumentProxy } = require('unpdf');

/**
 * Minimo de caracteres alfanumericos para considerar que a pagina tem camada
 * de texto aproveitavel.
 *
 * O corte nao pode ser `texto !== ''`: cupom escaneado costuma trazer uma
 * camada de texto residual — numero de pagina, marca d'agua do scanner, um
 * fragmento solto — que passaria no teste de string vazia e mandaria a pagina
 * para a rota digital, onde nao ha o que extrair. Um cupom fiscal de verdade
 * tem centenas de caracteres; 40 separa os dois casos com folga.
 */
const MIN_USEFUL_CHARS = 40;

function countAlphanumeric(text) {
  const matches = text.match(/[\p{L}\p{N}]/gu);
  return matches ? matches.length : 0;
}

function hasUsefulText(text) {
  return countAlphanumeric(text) >= MIN_USEFUL_CHARS;
}

/**
 * Texto de cada pagina do PDF.
 *
 * Funcao pura: recebe bytes, devolve dados. Nao toca em banco nem em HTTP —
 * quem persiste e o pipeline, e isso e o que permite testar a extracao com
 * uma fixture em memoria.
 *
 * Devolve `[{ pageNumber, text, useful }]`. Um PDF ilegivel estoura, e quem
 * chama decide o que fazer: aqui nao ha contexto para essa decisao.
 */
async function extractPages(buffer) {
  const document = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(document, { mergePages: false });

  return text.map((raw, index) => {
    const normalized = String(raw ?? '').trim();

    return {
      pageNumber: index + 1,
      text: normalized,
      useful: hasUsefulText(normalized),
    };
  });
}

module.exports = { extractPages, hasUsefulText, MIN_USEFUL_CHARS };
