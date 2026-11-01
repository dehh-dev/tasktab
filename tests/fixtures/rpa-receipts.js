'use strict';

const { PDFDocument } = require('pdf-lib');

/**
 * O PDF escaneado dos recibos assinados (RPCI) que o financeiro devolve
 * (issue 42): uma pagina por pessoa, so imagem, sem camada de texto — como o
 * cupom escaneado de `tests/fixtures/pdf.js`, desenhado direto no canvas.
 *
 * Nomes em caixa alta e sem acento, como o recibo do financeiro sai; CPF
 * sintetico, calculado pelo verificador. `cpf: null` tira a linha do CPF
 * (o recibo que so casa pelo nome).
 */
const SCAN_FONTS = ['DejaVu Sans', 'Liberation Sans', 'Noto Sans', 'Arial'];

function formatCpf(cpf) {
  return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

function receiptText({ name, cpf, net = '650,00', date = '20/10/2026' }) {
  return [
    'RECIBO DE PAGAMENTO A CONTRIBUINTE INDIVIDUAL',
    `Nome: ${name}`,
    ...(cpf ? [`CPF: ${formatCpf(cpf)}`] : []),
    'Valor bruto: R$ 730,33',
    'INSS: R$ 80,33',
    `Valor liquido: R$ ${net}`,
    `Data: ${date}`,
    '',
    '________________________________',
    'Assinatura',
  ];
}

async function scannedPage(lines) {
  const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
  const sharp = require('sharp');
  const available = GlobalFonts.families.map((entry) => entry.family);
  const family = SCAN_FONTS.find((name) => available.includes(name));

  if (!family) {
    throw new Error(
      `Nenhuma fonte utilizavel para o recibo escaneado. Procuradas: ${SCAN_FONTS.join(', ')}`,
    );
  }

  const canvas = createCanvas(1275, 1650);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#111111';
  context.font = `32px '${family}'`;

  lines.forEach((line, row) => {
    context.fillText(line, 80, 140 + row * 80);
  });

  // JPEG em tons de cinza, como sai de um scanner.
  const jpeg = await sharp(canvas.toBuffer('image/png'))
    .greyscale()
    .jpeg({ quality: 85 })
    .toBuffer();

  // A pagina em branco faria os testes de OCR nao afirmarem nada.
  const { data } = await sharp(jpeg)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ink = data.reduce((total, tone) => total + (tone < 128 ? 1 : 0), 0);
  if (ink < 5000) {
    throw new Error(`O recibo escaneado saiu quase em branco (${ink} pixels).`);
  }

  return jpeg;
}

/** `[{ name, cpf, net, date }]` -> um PDF, uma pagina Carta por recibo. */
async function makeScannedRpaReceipts(receipts) {
  const document = await PDFDocument.create();

  for (const receipt of receipts) {
    const image = await document.embedJpg(
      await scannedPage(receiptText(receipt)),
    );
    const page = document.addPage([612, 792]);
    page.drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
  }

  return Buffer.from(await document.save());
}

module.exports = { makeScannedRpaReceipts };
