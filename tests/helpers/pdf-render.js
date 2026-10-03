'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.resolve(__dirname, 'render-pdf-page.script.js');

/**
 * Pixels de uma pagina do PDF em tons de cinza, um byte por pixel, renderizada
 * em subprocesso — ver `render-pdf-page.script.js`.
 */
function renderPdfPage(buffer, pageNumber, { scale = 1 } = {}) {
  const tmpFile = path.join(
    os.tmpdir(),
    `pdf-render-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`,
  );
  fs.writeFileSync(tmpFile, buffer);

  try {
    const output = execFileSync(
      'node',
      [SCRIPT, tmpFile, String(pageNumber), String(scale)],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    const { width, height, channels, pixels } = JSON.parse(output);

    if (channels !== 1) {
      throw new Error(`esperado 1 canal de cinza, veio ${channels}`);
    }

    return { width, height, pixels: Buffer.from(pixels, 'base64') };
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

/**
 * Maior diferenca entre dois tons de cinza, linha a linha, nas `rows`
 * primeiras linhas das duas imagens. As larguras precisam ser iguais.
 */
function maxPixelDifference(a, b, rows) {
  if (a.width !== b.width) {
    throw new Error(`larguras diferentes: ${a.width} e ${b.width}`);
  }

  let max = 0;

  for (let offset = 0; offset < rows * a.width; offset += 1) {
    max = Math.max(max, Math.abs(a.pixels[offset] - b.pixels[offset]));
  }

  return max;
}

module.exports = { renderPdfPage, maxPixelDifference };
