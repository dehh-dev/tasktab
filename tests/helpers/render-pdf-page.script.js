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

async function main() {
  const [, , filePath, pageArg, scaleArg] = process.argv;
  const buffer = fs.readFileSync(filePath);

  const png = await renderPageAsImage(new Uint8Array(buffer), Number(pageArg), {
    canvasImport: () => import('@napi-rs/canvas'),
    scale: Number(scaleArg),
  });

  // Fundo branco antes do cinza: sem isso o canal alfa vira um segundo canal
  // e a comparacao byte a byte desalinha.
  const { data, info } = await sharp(Buffer.from(png))
    .flatten({ background: '#ffffff' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  process.stdout.write(
    JSON.stringify({
      width: info.width,
      height: info.height,
      channels: info.channels,
      pixels: data.toString('base64'),
    }),
  );
}

main().catch((error) => {
  process.stderr.write(String(error.stack || error.message));
  process.exitCode = 1;
});
