'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.resolve(__dirname, 'render-pdf-page.script.js');

/**
 * Pixels de paginas do PDF em tons de cinza, um byte por pixel, renderizadas
 * em subprocesso — ver `render-pdf-page.script.js`. Todas num processo so:
 * cada um custa ~200 ms para subir, mais que a pagina.
 */
function renderPdfPages(buffer, pageNumbers, { scale = 1 } = {}) {
  const tmpFile = path.join(
    os.tmpdir(),
    `pdf-render-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`,
  );
  fs.writeFileSync(tmpFile, buffer);

  try {
    const output = execFileSync(
      'node',
      [SCRIPT, tmpFile, pageNumbers.join(','), String(scale)],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
    );

    return JSON.parse(output).map(({ width, height, channels, pixels }) => {
      if (channels !== 1) {
        throw new Error(`esperado 1 canal de cinza, veio ${channels}`);
      }

      return { width, height, pixels: Buffer.from(pixels, 'base64') };
    });
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

function renderPdfPage(buffer, pageNumber, options) {
  return renderPdfPages(buffer, [pageNumber], options)[0];
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

module.exports = { renderPdfPage, renderPdfPages, maxPixelDifference };
