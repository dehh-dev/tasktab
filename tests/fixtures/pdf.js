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
async function makePdf({ pages = 1, text, lines } = {}) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);

  for (let index = 0; index < pages; index += 1) {
    const page = document.addPage([300, 400]);
    const content = lines ?? [text ?? `Pagina ${index + 1}`];

    // Uma linha por vez: um texto longo desenhado de uma vez so transborda a
    // largura da pagina e some da camada de texto.
    content.forEach((line, row) => {
      page.drawText(String(line), {
        x: 20,
        y: 370 - row * 14,
        size: 8,
        font,
      });
    });
  }

  return Buffer.from(await document.save());
}

/** Linhas de um cupom fiscal, no formato que a extracao vai encontrar. */
function receiptLines({
  name = 'MERCEARIA FRANGUINHO NA PANELA LTDA',
  cnpj = '26.048.802/0001-65',
  date = '19/06/2026',
  total = '37,60',
  extra = [],
} = {}) {
  return [
    name,
    `CNPJ ${cnpj}`,
    'Rua das Flores, 120 - Centro - Abadiania/GO',
    'CUPOM FISCAL ELETRONICO - NFC-e',
    'Documento auxiliar da Nota Fiscal de Consumidor Eletronica',
    `Emissao: ${date} 12:34:56`,
    'ITEM 001 REFEICAO COMERCIAL 1 UN',
    `VALOR TOTAL R$ ${total}`,
    'FORMA DE PAGAMENTO: CARTAO DE CREDITO',
    ...extra,
  ];
}

/** PDF de um cupom com camada de texto, como os PDFs digitais reais. */
function makeReceiptPdf(options = {}) {
  const { pages, ...rest } = options;
  return makePdf({ pages, lines: receiptLines(rest) });
}

/**
 * Cupom com QR Code de verdade, como os NFC-e impressos.
 *
 * O QR carrega a URL de consulta da SEFAZ com a chave embutida — e o formato
 * real, e nao a chave solta, para que o teste exercite a extracao da chave de
 * dentro da URL.
 */
async function makeQrReceiptPdf({ accessKey, ...rest } = {}) {
  const { writeBarcode } = require('zxing-wasm');

  const url = `https://nfe.sefaz.go.gov.br/nfeweb/consulta?p=${accessKey}|2|1|1`;
  const { image } = await writeBarcode(url, { format: 'QRCode', scale: 8 });
  const png = Buffer.from(await image.arrayBuffer());

  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([300, 400]);

  receiptLines(rest).forEach((line, row) => {
    page.drawText(String(line), { x: 20, y: 370 - row * 14, size: 8, font });
  });

  const embedded = await document.embedPng(png);
  page.drawImage(embedded, { x: 20, y: 60, width: 160, height: 160 });

  return Buffer.from(await document.save());
}

/** Bytes que comecam com %PDF- mas nao formam um documento valido. */
function makeCorruptPdf() {
  return Buffer.from('%PDF-1.7\nisto nao e um PDF de verdade\n%%EOF');
}

/** Arquivo que nao e PDF nenhum, para o teste de magic bytes. */
function makeNonPdf() {
  return Buffer.from('PK isto parece um zip');
}

module.exports = {
  makePdf,
  makeReceiptPdf,
  makeQrReceiptPdf,
  receiptLines,
  makeCorruptPdf,
  makeNonPdf,
};
