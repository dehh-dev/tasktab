'use strict';

/**
 * Gera o logo e o cabecalho SINTETICOS do RPA em `assets/` (issue 40).
 *
 * **Isto NAO e o logo nem o controle de documentos da empresa.** O
 * repositorio e publico, e o FORM.DRH.03 real leva o logo e a identificacao
 * do documento de quem emite. Na instalacao, troque:
 *
 * - `assets/rpa-logo.png` pelo logo de verdade (PNG; o PDF o encaixa no
 *   quadro do canto, sem deformar);
 * - `assets/rpa-form.json` pela identificacao, versao e data de aprovacao do
 *   formulario.
 *
 * Roda uma vez, offline — nao faz parte do runtime. Rodar de novo
 * **sobrescreve** os dois arquivos.
 * `npm run generate:rpa-assets`
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ASSETS = path.resolve(__dirname, '../assets');
const WIDTH = 240;
const HEIGHT = 96;

const HEADER = {
  title: 'CONTROLE DE DOCUMENTOS E REGISTROS',
  subtitle: 'EMISSÃO DE RPA',
  identification: 'FORM.EXEMPLO.01',
  version: '1',
  approved_on: '2026-01-01',
};

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Um quadro cinza-azulado com uma faixa diagonal: so para ocupar o lugar. */
function pixel(x, y) {
  const border = x < 3 || y < 3 || x >= WIDTH - 3 || y >= HEIGHT - 3;
  const band = Math.abs(x - y * 2.5 - 20) < 18;
  if (border) return [40, 56, 82];
  if (band) return [120, 144, 176];
  return [214, 222, 234];
}

function png() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header.writeUInt8(8, 8); // bits por canal
  header.writeUInt8(2, 9); // RGB
  const rows = [];

  for (let y = 0; y < HEIGHT; y += 1) {
    const row = [0]; // sem filtro
    for (let x = 0; x < WIDTH; x += 1) row.push(...pixel(x, y));
    rows.push(Buffer.from(row));
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(ASSETS, { recursive: true });
fs.writeFileSync(path.join(ASSETS, 'rpa-logo.png'), png());
fs.writeFileSync(
  path.join(ASSETS, 'rpa-form.json'),
  `${JSON.stringify(HEADER, null, 2)}\n`,
);

process.stdout.write('assets/rpa-logo.png e assets/rpa-form.json gerados\n');
