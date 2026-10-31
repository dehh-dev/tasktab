'use strict';

const zlib = require('zlib');
const JSZip = require('jszip');
const sharp = require('sharp');

/**
 * O .zip da pasta de respostas do formulario como o Drive o baixa (issue 41):
 * uma pasta do formulario, uma subpasta por pergunta e cada arquivo como
 * `<nome original> - <nome da conta Google>`. Os titulos sao os das
 * perguntas reais de Avare; imagens e nomes sao sinteticos.
 */
const ROOT = 'Cadastro AVARE (File responses)';

const QUESTIONS = {
  ctpsFront:
    'Anexar Documentos Carteira de Trabalho FRENTE (Lado de Foto) (File responses)',
  ctpsBack:
    'Anexar Documentos Carteira de Trabalho VERSO (Lado dos Dados) (File responses)',
  idFront:
    'Anexar Documentos RG  ou CNH   FRENTE (Lado de Foto) (File responses)',
  idBack:
    'Anexar Documentos RG  ou CNH  VERSO (Lado dos Dados) (File responses)',
  address: 'Anexar Documentos Comprovantes de ENDEREÇO (File responses)',
  bank: 'Anexar Documentos Dados Bancarios (Print ou Fotos) (File responses)',
};

/** Uma foto pequena de cor solida: cada `seed` da um conteudo (e hash) proprio. */
function photo(seed, { format = 'jpeg' } = {}) {
  const image = sharp({
    create: {
      width: 64,
      height: 48,
      channels: 3,
      background: {
        r: (seed * 53) % 256,
        g: (seed * 97) % 256,
        b: (seed * 151) % 256,
      },
    },
  });
  return (format === 'png' ? image.png() : image.jpeg()).toBuffer();
}

/**
 * Bytes pseudoaleatorios a partir de uma semente (xorshift32): o mesmo `seed`
 * da sempre o mesmo conteudo, e o mesmo hash. Os arquivos grandes dos testes
 * vao para o diretorio de upload pelo hash; aleatorio de verdade deixaria uma
 * copia nova de varios MB a cada execucao.
 */
function seededBytes(seed, length) {
  const bytes = Buffer.alloc(length);
  let state = (seed * 2654435761) >>> 0 || 1;

  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    bytes[index] = state & 0xff;
  }

  return bytes;
}

/**
 * Foto de celular de 4032 x 3024 com ruido: o ruido nao comprime, e o
 * arquivo fica do tamanho das fotos reais (varios MB).
 */
function phonePhoto(seed) {
  const width = 4032;
  const height = 3024;
  const pixels = seededBytes(seed + 1, width * height * 3);

  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = (pixels[index] & 0x3f) + ((seed * 31 + index) % 160);
  }

  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 92 })
    .toBuffer();
}

/** "PDF" de `megabytes` MB que nenhuma compressao reduz. */
function bigPdf(seed, megabytes) {
  return Buffer.concat([
    Buffer.from('%PDF-1.7\n'),
    seededBytes(seed + 101, megabytes * 1024 * 1024 + seed),
  ]);
}

/** `[{ question, name, data }]` -> o .zip, com a pasta do formulario na raiz. */
async function makeDriveZip(files, { extra = [] } = {}) {
  const zip = new JSZip();

  for (const file of files) {
    zip.file(`${ROOT}/${file.question}/${file.name}`, file.data);
  }
  for (const file of extra) {
    zip.file(file.path, file.data);
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * .zip montado byte a byte, para declarar o tamanho que se quiser: e assim
 * que se monta a bomba que mente o tamanho descompactado.
 * `[{ name, data, declaredSize? }]`, sempre comprimido (deflate).
 */
function rawZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = zlib.deflateRawSync(entry.data);
    const size = entry.declaredSize ?? entry.data.length;
    const crc = zlib.crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, compressed);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, end]);
}

module.exports = {
  ROOT,
  QUESTIONS,
  photo,
  phonePhoto,
  bigPdf,
  makeDriveZip,
  rawZip,
};
