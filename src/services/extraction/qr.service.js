'use strict';

const accessKey = require('./access-key');

/**
 * Leitura de QR Code da pagina de um cupom.
 *
 * O QR da NFC-e carrega uma URL de consulta com a chave de acesso embutida.
 * Ler o QR e melhor que ler o texto por dois motivos: o codigo tem correcao de
 * erro propria, e a chave ainda passa pelo DV — duas barreiras antes do dado
 * virar lancamento.
 *
 * As dependencias pesadas (`pdfjs-dist`, `@napi-rs/canvas`, `sharp`,
 * `zxing-wasm`) sao carregadas sob demanda: a maioria das paginas resolve pelo
 * texto, e importar tudo no boot cobraria a memoria de quem nunca chega aqui.
 */

// Escala de renderizacao. Cupom termico tem QR pequeno; abaixo de 2x o
// decodificador erra com frequencia, e acima de 3x o ganho nao paga o tempo.
const RENDER_SCALE = 3;

async function renderPageToPng(buffer, pageNumber) {
  const { renderPageAsImage } = require('unpdf');

  // O canvas entra por injecao: o pdf.js que o unpdf empacota nao resolve
  // `@napi-rs/canvas` sozinho, e sem isso a renderizacao estoura com
  // "canvas is not available in this environment".
  const png = await renderPageAsImage(new Uint8Array(buffer), pageNumber, {
    canvasImport: () => import('@napi-rs/canvas'),
    scale: RENDER_SCALE,
  });

  return Buffer.from(png);
}

/**
 * Cinza e normalizacao de contraste: e onde o decodificador ganha ou perde.
 *
 * O zxing espera **RGBA**, quatro bytes por pixel. `greyscale()` devolve um
 * canal so, e entregar esse buffer direto nao da erro: o wasm le alem do fim e
 * responde com lixo — na pratica, com o resultado da imagem anterior. Por isso
 * a expansao para RGBA e explicita, e o tamanho e conferido antes de sair
 * daqui. Bug silencioso desta familia e o que este projeto existe para evitar.
 */
async function preprocess(png) {
  const sharp = require('sharp');

  const { data, info } = await sharp(png)
    .greyscale()
    .normalise()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const rgba = new Uint8ClampedArray(width * height * 4);

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const tone = data[pixel * info.channels];
    const at = pixel * 4;

    rgba[at] = tone;
    rgba[at + 1] = tone;
    rgba[at + 2] = tone;
    rgba[at + 3] = 255;
  }

  if (rgba.length !== width * height * 4) {
    throw new Error(
      `imagem com ${rgba.length} bytes, esperado ${width * height * 4} (RGBA)`,
    );
  }

  return { data: rgba, width, height };
}

async function decode(imageData) {
  const { readBarcodesFromImageData } = require('zxing-wasm');

  const results = await readBarcodesFromImageData(imageData, {
    formats: ['QRCode'],
    tryHarder: true,
  });

  return results.map((result) => result.text).filter(Boolean);
}

/**
 * Chave de acesso valida encontrada no QR da pagina, ou `null`.
 *
 * O texto do QR e uma URL; a chave sai dela por qualquer sequencia de 44
 * digitos que feche o DV. Um QR ilegivel devolve `null` sem estourar — quem
 * chama cai para a leitura do texto impresso.
 */
async function readAccessKey(buffer, pageNumber) {
  const png = await renderPageToPng(buffer, pageNumber);
  const imageData = await preprocess(png);
  const texts = await decode(imageData);

  for (const text of texts) {
    for (const candidate of String(text).match(/\d{44}/g) || []) {
      if (accessKey.isValid(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

module.exports = { readAccessKey, renderPageToPng, RENDER_SCALE };
