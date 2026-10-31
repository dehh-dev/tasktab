'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const JSZip = require('jszip');
const env = require('../../config/env');
const RpaFile = require('../../models/rpa-file.model');
const Worker = require('../../models/rpa-worker.model');
const retention = require('../retention.service');
const { ValidationError } = require('../../../infra/errors');
const { logger } = require('../../../infra/logger');
const { ZipError, listEntries, readEntry } = require('./zip-reader');
const {
  classify,
  accountName,
  detectType,
  matchWorker,
  folderName,
  documentFileName,
  uniqueName,
} = require('./documents');

/**
 * Os documentos do formulario (issue 41): o .zip da pasta de respostas do
 * Drive entra, cada arquivo vai para a pessoa e o tipo certos, e sai um .zip
 * com uma pasta por pessoa — o que hoje se monta na mao para o e-mail.
 *
 * Nada aqui loga nome de arquivo, nome de pessoa ou documento: so contagens.
 */

// O limite de anexo do Gmail.
const EMAIL_LIMIT_BYTES = 25 * 1024 * 1024;
// Foto acima disso e reduzida na versao para e-mail; o PDF segue como veio.
const EMAIL_REDUCE_ABOVE_BYTES = 1024 * 1024;
const EMAIL_MAX_SIDE = 2400;
const EMAIL_JPEG_QUALITY = 85;

// Lixo que o macOS e o Windows poem no .zip.
const IGNORED = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i;

function asValidation(error) {
  if (!(error instanceof ZipError)) return error;

  return new ValidationError({
    message: `O .zip foi recusado: ${error.message}.`,
    action:
      'Baixe de novo a pasta de respostas do Drive (Fazer download) e envie o .zip que ele gera.',
    details: [{ field: 'file', message: error.message }],
  });
}

/** Grava pelo hash; o arquivo que ja esta no disco fica como esta. */
async function store(hash, extension, data) {
  const filePath = `${hash}.${extension}`;

  try {
    await fsp.writeFile(path.join(env.upload.dir, filePath), data, {
      flag: 'wx',
    });
    return { filePath, written: true };
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return { filePath, written: false };
  }
}

/**
 * Le o .zip ja no disco (`tempPath`) e grava os documentos. Frente e verso
 * com o mesmo conteudo viram um arquivo so, sem lado. Arquivo de pasta que
 * nao e de pergunta conhecida, ou de formato que nao e foto nem PDF, volta em
 * `rejected` com o nome da entrada — na resposta, nunca no log.
 */
async function importDocuments(launch, tempPath, log = logger) {
  const handle = await fsp.open(tempPath, 'r');
  const written = [];

  try {
    const { size } = await handle.stat();
    const entries = await listEntries(handle, size).catch((error) => {
      throw asValidation(error);
    });
    const workers = await Worker.findRoster(launch.id);
    const byHash = new Map();
    const rejected = [];
    let repeated = 0;

    for (const entry of entries) {
      if (IGNORED.test(entry.name) || entry.uncompressed === 0) continue;

      const place = classify(entry.name);
      if (!place) {
        rejected.push({
          name: entry.name,
          reason: 'pasta de pergunta desconhecida',
        });
        continue;
      }

      const data = await readEntry(handle, entry).catch((error) => {
        throw asValidation(error);
      });
      const type = detectType(data);
      if (!type) {
        rejected.push({ name: entry.name, reason: 'nao e foto nem PDF' });
        continue;
      }

      const hash = crypto.createHash('sha256').update(data).digest('hex');
      const seen = byHash.get(hash);

      if (seen) {
        repeated += 1;
        if (seen.kind === place.kind && seen.side !== place.side) {
          seen.side = null;
        }
        continue;
      }

      const account = accountName(entry.name);
      const stored = await store(hash, type.extension, data);
      if (stored.written) {
        written.push({ file_hash: hash, file_path: stored.filePath });
      }

      byHash.set(hash, {
        worker_id: matchWorker(account, workers)?.id ?? null,
        kind: place.kind,
        side: place.side,
        file_hash: hash,
        file_path: stored.filePath,
        content_type: type.contentType,
        byte_size: data.length,
        source_name: account,
      });
    }

    const files = [...byHash.values()];
    const saved = await RpaFile.insertDocuments(launch.id, files);

    return {
      received: files.length + repeated,
      stored: files.length,
      repeated,
      created: saved.created,
      assigned: saved.assigned,
      rejected,
      documents: await RpaFile.findDocuments(launch.id),
    };
  } catch (error) {
    // O que este envio gravou e nao ficou referenciado sai do disco.
    await retention.discardOrphans(written, log);
    throw error;
  } finally {
    await handle.close();
    await fsp.unlink(tempPath).catch(() => {});
  }
}

/**
 * A foto para o e-mail: ate 2.400 px no lado maior, JPEG q85, ja virada pela
 * orientacao da camera. O que o `sharp` nao le (HEIC sem o codec) vai como
 * veio e conta em `kept`.
 */
async function forEmail(file, data) {
  if (
    file.content_type === 'application/pdf' ||
    data.length <= EMAIL_REDUCE_ABOVE_BYTES
  ) {
    return {
      data,
      extension: file.file_path.split('.').at(-1),
      reduced: false,
    };
  }

  try {
    const sharp = require('sharp');
    const reduced = await sharp(data)
      .rotate()
      .resize(EMAIL_MAX_SIDE, EMAIL_MAX_SIDE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: EMAIL_JPEG_QUALITY })
      .toBuffer();
    return { data: reduced, extension: 'jpg', reduced: true };
  } catch {
    return {
      data,
      extension: file.file_path.split('.').at(-1),
      reduced: false,
    };
  }
}

function megabytes(bytes) {
  return Math.ceil(bytes / (1024 * 1024));
}

/**
 * O .zip com uma pasta `NOME SOBRENOME` por pessoa e o prefixo do tipo em
 * cada arquivo. Documento sem pessoa fica de fora: aparece na lista para
 * alguem escolher. Arquivo fora do disco e `422` com todos de uma vez, antes
 * de comecar a responder.
 *
 * Sem `email`, os arquivos vao como estao, lidos do disco em fluxo. Com
 * `email`, as fotos sao reduzidas e o .zip e montado em memoria, para a
 * resposta dizer se passou dos 25 MB do Gmail.
 */
async function documentsZip(launch, { email = false } = {}) {
  const files = (
    await RpaFile.findDocuments(launch.id, { withPath: true })
  ).filter((file) => file.worker_id !== null);

  if (files.length === 0) {
    throw new ValidationError({
      message: 'O lancamento nao tem documento com pessoa.',
      action: 'Envie o .zip das respostas ou escolha a pessoa dos documentos.',
      details: [{ field: 'documents', message: 'nenhum documento' }],
    });
  }

  const missing = [];
  await Promise.all(
    files.map((file) =>
      fsp.access(path.join(env.upload.dir, file.file_path)).catch(() => {
        missing.push({
          field: `documents[${file.id}]`,
          message: 'arquivo ausente do disco',
        });
      }),
    ),
  );
  if (missing.length > 0) {
    throw new ValidationError({
      message: 'Ha documentos que nao estao mais no disco.',
      action: 'Envie o .zip das respostas de novo: ele devolve o que faltou.',
      details: missing,
    });
  }

  const zip = new JSZip();
  const folders = new Map();
  const usedFolders = new Set();
  let kept = 0;

  for (const file of files) {
    if (!folders.has(file.worker_id)) {
      folders.set(file.worker_id, {
        name: uniqueName(folderName(file.worker_name), usedFolders),
        used: new Set(),
      });
    }
    const folder = folders.get(file.worker_id);
    const location = path.join(env.upload.dir, file.file_path);

    if (email) {
      const content = await forEmail(file, await fsp.readFile(location));
      if (
        !content.reduced &&
        file.content_type !== 'application/pdf' &&
        content.data.length > EMAIL_REDUCE_ABOVE_BYTES
      ) {
        kept += 1;
      }
      const name = uniqueName(
        documentFileName({ ...file, extension: content.extension }),
        folder.used,
      );
      zip.file(`${folder.name}/${name}`, content.data);
    } else {
      const name = uniqueName(
        documentFileName({
          ...file,
          extension: file.file_path.split('.').at(-1),
        }),
        folder.used,
      );
      zip.file(`${folder.name}/${name}`, fs.createReadStream(location));
    }
  }

  const place = `${launch.city}-${launch.state}`;

  if (!email) {
    return {
      fileName: `Documentos - ${place}.zip`,
      stream: zip.generateNodeStream({
        type: 'nodebuffer',
        streamFiles: true,
        compression: 'STORE',
      }),
    };
  }

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'STORE',
  });
  const warnings = [];
  if (buffer.length > EMAIL_LIMIT_BYTES) {
    warnings.push(
      `O .zip tem ${megabytes(buffer.length)} MB, acima dos 25 MB do Gmail: envie em mais de um e-mail.`,
    );
  }
  if (kept > 0) {
    warnings.push(
      `${kept} foto(s) nao puderam ser reduzidas e foram como vieram.`,
    );
  }

  return {
    fileName: `Documentos - ${place} (e-mail).zip`,
    buffer,
    warnings,
  };
}

module.exports = {
  EMAIL_LIMIT_BYTES,
  importDocuments,
  documentsZip,
};
