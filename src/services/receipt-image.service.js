'use strict';

const qrService = require('./extraction/qr.service');

/**
 * Imagem da pagina do comprovante para a tela de revisao.
 *
 * Separado do render do QR de proposito: aquele existe para o zxing decodificar
 * um codigo, este para uma pessoa ler um cupom amassado a 300% de zoom. Os dois
 * alvos pedem escalas diferentes, e amarrar um ao outro obrigaria a piorar um
 * para melhorar o outro.
 *
 * **A escala nao e chute.** Os PDFs reais deste projeto sao digitalizacoes a
 * 257 ppi: uma pagina de 1000pt traz uma imagem embutida de 3568px, ou seja
 * 3,57x os pontos da pagina. Renderizando a 3x o resultado saia com 3000px —
 * **abaixo** do original, jogando fora detalhe que estava no arquivo. 4x cobre
 * 288 ppi e passa a ler o scan inteiro; acima disso so haveria interpolacao,
 * porque o dado nao existe no PDF.
 */
const DISPLAY_SCALE = 4;

// Teto do lado maior. A escala e cega ao tamanho da pagina: um documento em A0
// a 4x passaria de 13000px e derrubaria a aba do navegador antes de mostrar
// qualquer coisa.
const MAX_EDGE = 4200;

// WebP e nao PNG. Medido na pagina escaneada de 4000x1908: PNG sai com 2913 KB
// e WebP q92 com 451 KB — quatro vezes menos que o PNG a 3x que era servido
// antes, e ainda assim com mais resolucao. Para um scan fotografico a perda de
// q92 nao aparece; o custo e ~0,5s de codificacao, pago uma vez por
// comprovante graças ao ETag e ao `max-age` de um dia.
const WEBP_QUALITY = 92;

async function render(buffer, pageNumber) {
  const sharp = require('sharp');

  const png = await qrService.renderPageToPng(
    buffer,
    pageNumber,
    DISPLAY_SCALE,
  );

  const data = await sharp(png)
    .resize({
      width: MAX_EDGE,
      height: MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();

  return { data, contentType: 'image/webp' };
}

module.exports = { render, DISPLAY_SCALE, MAX_EDGE, WEBP_QUALITY };
