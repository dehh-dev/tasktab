'use strict';

const db = require('../config/database');

/**
 * Documentos do formulario e recibos assinados do RPA (issues 41 e 42).
 *
 * A contagem por hash e o que a retencao precisa para nao apagar do disco um
 * arquivo que o RPA ainda referencia.
 */
async function countByHash(fileHash) {
  const { rows } = await db.query(
    'SELECT COUNT(*)::int AS total FROM rpa_files WHERE file_hash = $1',
    [fileHash],
  );
  return rows[0].total;
}

/**
 * Os arquivos de um lancamento, levantados **antes** de apaga-lo: a cascata da
 * FK leva as linhas, e depois nao ha mais como saber o que estava no disco.
 */
async function findFilesByLaunch(launchId) {
  const { rows } = await db.query(
    'SELECT file_hash, file_path FROM rpa_files WHERE launch_id = $1',
    [launchId],
  );
  return rows;
}

module.exports = { countByHash, findFilesByLaunch };
