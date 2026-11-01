'use strict';

const fs = require('fs/promises');
const path = require('path');

const Receipt = require('../models/receipt.model');
const RpaFile = require('../models/rpa-file.model');
const RpaReceiptBatch = require('../models/rpa-receipt-batch.model');
const env = require('../config/env');

/**
 * Quem ainda guarda um arquivo do diretorio de upload. Comprovantes e
 * arquivos do RPA dividem o diretorio e o nome pelo SHA-256: o mesmo PDF pode
 * ser um cupom e o recibo de uma pessoa. Tabela nova que grave ali entra
 * nesta lista, ou a primeira exclusao leva o arquivo dela.
 */
const REFERENCE_COUNTERS = [
  Receipt.countByHash,
  RpaFile.countByHash,
  RpaReceiptBatch.countByHash,
];

async function countReferences(fileHash) {
  const counts = await Promise.all(
    REFERENCE_COUNTERS.map((count) => count(fileHash)),
  );
  return counts.reduce((total, count) => total + count, 0);
}

/**
 * Apaga do disco os arquivos que nada mais referencia.
 *
 * O arquivo e gravado com o proprio SHA-256 como nome, entao um mesmo PDF
 * atende todas as paginas dele e ainda e reaproveitado por outro relatorio que
 * receba o mesmo upload. Apagar junto com a primeira linha removida levaria
 * embora o cupom das outras — a contagem por hash e o que impede isso.
 *
 * Chamar **depois** de a linha ja ter saido do banco: o que sobrar na contagem
 * sao referencias vivas de verdade.
 *
 * @param {{ file_hash: string, file_path: string }[]} files
 * @param {import('pino').Logger} log
 */
async function discardOrphans(files, log) {
  for (const file of files) {
    const remaining = await countReferences(file.file_hash);

    if (remaining > 0) {
      continue;
    }

    try {
      await fs.unlink(path.join(env.upload.dir, file.file_path));
    } catch (error) {
      if (error.code === 'ENOENT') {
        continue;
      }

      // O registro ja saiu do banco: derrubar a resposta agora nao o traz de
      // volta, e o cliente ficaria achando que a exclusao falhou. Fica o aviso,
      // que e o que permite varrer o diretorio depois.
      log.warn(
        { err: error, file: file.file_path },
        'arquivo enviado nao removido do disco',
      );
    }
  }
}

module.exports = { discardOrphans };
