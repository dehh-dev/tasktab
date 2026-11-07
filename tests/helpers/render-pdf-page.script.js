'use strict';

/**
 * Renderiza uma pagina de PDF e devolve os pixels em tons de cinza.
 *
 * Roda em processo Node puro, pelo mesmo motivo do
 * `extract-pdf-text.script.js`: o `unpdf` carrega o pdf.js por import
 * dinamico, que a VM do Jest recusa. O pdf.js aplica o `/Rotate` da pagina, e
 * e isso que permite comparar a pagina exportada com a original como ela e
 * exibida.
 */
const fs = require('fs');
const sharp = require('sharp');
const { renderPageAsImage } = require('unpdf');

async function renderPage(buffer, pageNumber, scale) {
  const png = await renderPageAsImage(new Uint8Array(buffer), pageNumber, {
    canvasImport: () => import('@napi-rs/canvas'),
    scale,
  });

  // Fundo branco antes do cinza: sem isso o canal alfa vira um segundo canal
  // e a comparacao byte a byte desalinha.
  const { data, info } = await sharp(Buffer.from(png))
    .flatten({ background: '#ffffff' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    width: info.width,
    height: info.height,
    channels: info.channels,
    pixels: data.toString('base64'),
  };
}

// As paginas vem separadas por virgula ("2,3,4"): subir o processo custa mais
// que renderizar uma pagina, entao quem compara varias pede todas de uma vez.
async function main() {
  const [, , filePath, pagesArg, scaleArg] = process.argv;
  const buffer = fs.readFileSync(filePath);
  const pages = [];

  for (const page of pagesArg.split(',')) {
    pages.push(await renderPage(buffer, Number(page), Number(scaleArg)));
  }

  process.stdout.write(JSON.stringify(pages));
}

main().catch((error) => {
  process.stderr.write(String(error.stack || error.message));
  process.exitCode = 1;
});
