'use strict';

const crypto = require('crypto');
const { PDFDocument } = require('pdf-lib');

// Todo PDF comeca com %PDF-. Conferir a extensao nao serve de nada: quem
// renomeia um .exe para .pdf passa, e quem manda um PDF valido com outro nome
// seria recusado sem motivo.
const PDF_MAGIC = Buffer.from('%PDF-');

function isPdf(buffer) {
  return buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Numero de paginas do documento.
 *
 * PDF protegido por senha ou corrompido faz o `load` estourar — quem chama
 * trata isso como pagina unica em `failed`, com o motivo gravado. Um lote de
 * 30 cupons nao pode ser perdido por causa de um arquivo ruim.
 */
async function countPages(buffer) {
  const document = await PDFDocument.load(buffer);
  return document.getPageCount();
}

module.exports = { isPdf, sha256, countPages };
