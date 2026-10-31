'use strict';

const zlib = require('zlib');

/**
 * Leitor de .zip para os documentos do formulario (issue 41), sobre um
 * arquivo aberto (`fs.FileHandle`): o .zip do Drive pode ter centenas de MB e
 * nao precisa caber inteiro na memoria.
 *
 * A defesa contra bomba de compressao vem em duas camadas:
 *
 * 1. `listEntries` le so o diretorio central e recusa o .zip inteiro, antes
 *    de descompactar qualquer coisa, se o numero de entradas, o tamanho
 *    descompactado de uma entrada ou a soma passarem do limite.
 * 2. `readEntry` descompacta com `maxOutputLength` igual ao tamanho declarado:
 *    a entrada que mente o tamanho para no primeiro byte a mais. CRC e tamanho
 *    final sao conferidos.
 *
 * O nome da entrada so serve para achar a pasta e o nome da conta: nunca vira
 * caminho no disco (o arquivo e gravado pelo SHA-256).
 */
const SIGNATURE = {
  end: 0x06054b50,
  central: 0x02014b50,
  local: 0x04034b50,
};
const END_RECORD = 22;
const MAX_COMMENT = 0xffff;
const ZIP64 = 0xffffffff;

const DEFAULT_LIMITS = {
  entries: 2000,
  entryBytes: 50 * 1024 * 1024,
  totalBytes: 400 * 1024 * 1024,
};

/** Erro do .zip em si: o servico o devolve como 422, com a mensagem. */
class ZipError extends Error {}

async function read(handle, position, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw new ZipError('o arquivo esta incompleto');
  return buffer;
}

function megabytes(bytes) {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

async function findEnd(handle, size) {
  if (size < END_RECORD) throw new ZipError('o arquivo nao e um .zip');

  const length = Math.min(size, END_RECORD + MAX_COMMENT);
  const tail = await read(handle, size - length, length);

  for (let at = length - END_RECORD; at >= 0; at -= 1) {
    if (tail.readUInt32LE(at) === SIGNATURE.end) {
      return {
        count: tail.readUInt16LE(at + 10),
        size: tail.readUInt32LE(at + 12),
        offset: tail.readUInt32LE(at + 16),
      };
    }
  }

  throw new ZipError('o arquivo nao e um .zip');
}

/**
 * As entradas de arquivo (pastas ficam de fora), conferidas contra os limites
 * so pelo que o diretorio central declara.
 */
async function listEntries(handle, size, limits = DEFAULT_LIMITS) {
  const end = await findEnd(handle, size);

  if (end.count === 0xffff || end.offset === ZIP64) {
    throw new ZipError('o .zip e grande demais (zip64) para ser lido');
  }
  if (end.count > limits.entries) {
    throw new ZipError(`o .zip tem mais de ${limits.entries} arquivos`);
  }
  if (end.offset + end.size > size) {
    throw new ZipError('o .zip esta corrompido');
  }

  const central = await read(handle, end.offset, end.size);
  const entries = [];
  let total = 0;
  let at = 0;

  for (let index = 0; index < end.count; index += 1) {
    if (
      at + 46 > central.length ||
      central.readUInt32LE(at) !== SIGNATURE.central
    ) {
      throw new ZipError('o .zip esta corrompido');
    }

    const flags = central.readUInt16LE(at + 8);
    const method = central.readUInt16LE(at + 10);
    const crc = central.readUInt32LE(at + 16);
    const compressed = central.readUInt32LE(at + 20);
    const uncompressed = central.readUInt32LE(at + 24);
    const nameLength = central.readUInt16LE(at + 28);
    const extraLength = central.readUInt16LE(at + 30);
    const commentLength = central.readUInt16LE(at + 32);
    const localOffset = central.readUInt32LE(at + 42);
    // O Drive grava o nome em UTF-8; o .zip antigo sem a marca tambem cai
    // aqui, e no pior caso o nome sai com `?` — ele nao vira caminho.
    const name = central.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue;

    if (flags & 0x1) {
      throw new ZipError('o .zip esta protegido por senha');
    }
    if (method !== 0 && method !== 8) {
      throw new ZipError('o .zip usa uma compressao que nao e lida');
    }
    if (
      compressed === ZIP64 ||
      uncompressed === ZIP64 ||
      localOffset === ZIP64
    ) {
      throw new ZipError('o .zip e grande demais (zip64) para ser lido');
    }
    if (uncompressed > limits.entryBytes) {
      throw new ZipError(
        `um arquivo do .zip passa de ${megabytes(limits.entryBytes)} descompactado`,
      );
    }

    total += uncompressed;
    if (total > limits.totalBytes) {
      throw new ZipError(
        `o .zip passa de ${megabytes(limits.totalBytes)} descompactado`,
      );
    }

    entries.push({ name, method, crc, compressed, uncompressed, localOffset });
  }

  return entries;
}

/** O conteudo de uma entrada, sem passar do tamanho que ela declarou. */
async function readEntry(handle, entry) {
  const header = await read(handle, entry.localOffset, 30);
  if (header.readUInt32LE(0) !== SIGNATURE.local) {
    throw new ZipError('o .zip esta corrompido');
  }

  const start =
    entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  const compressed = await read(handle, start, entry.compressed);
  let data = compressed;

  if (entry.method === 8) {
    try {
      data = zlib.inflateRawSync(compressed, {
        maxOutputLength: Math.max(1, entry.uncompressed),
      });
    } catch (error) {
      if (error.code === 'ERR_BUFFER_TOO_LARGE') {
        throw new ZipError(
          'um arquivo do .zip descompacta mais do que declara',
        );
      }
      throw new ZipError('o .zip esta corrompido');
    }
  }

  if (data.length !== entry.uncompressed || zlib.crc32(data) !== entry.crc) {
    throw new ZipError('o .zip esta corrompido');
  }

  return data;
}

module.exports = { DEFAULT_LIMITS, ZipError, listEntries, readEntry };
