'use strict';

const { PDFDocument, StandardFonts } = require('pdf-lib');

/**
 * PDFs sinteticos para a suite.
 *
 * **Nenhum documento real e versionado**: os cupons desta prestacao de contas
 * trazem CPF, CNPJ e endereco de terceiros. O que os testes precisam e de
 * estrutura — numero de paginas, camada de texto, arquivo ilegivel — e isso se
 * gera em memoria, sem pesar o repositorio.
 */
async function makePdf({ pages = 1, text } = {}) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);

  for (let index = 0; index < pages; index += 1) {
    const page = document.addPage([300, 400]);

    page.drawText(text || `Pagina ${index + 1}`, {
      x: 20,
      y: 350,
      size: 12,
      font,
    });
  }

  return Buffer.from(await document.save());
}

/** Bytes que comecam com %PDF- mas nao formam um documento valido. */
function makeCorruptPdf() {
  return Buffer.from('%PDF-1.7\nisto nao e um PDF de verdade\n%%EOF');
}

/** Arquivo que nao e PDF nenhum, para o teste de magic bytes. */
function makeNonPdf() {
  return Buffer.from('PK isto parece um zip');
}

module.exports = { makePdf, makeCorruptPdf, makeNonPdf };
