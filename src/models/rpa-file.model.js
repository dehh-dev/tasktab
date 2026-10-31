'use strict';

const db = require('../config/database');

/**
 * Documentos do formulario e recibos assinados do RPA (issues 41 e 42).
 *
 * Por enquanto so a contagem por hash: e o que a retencao precisa para nao
 * apagar do disco um arquivo que o RPA ainda referencia.
 */
async function countByHash(fileHash) {
  const { rows } = await db.query(
    'SELECT COUNT(*)::int AS total FROM rpa_files WHERE file_hash = $1',
    [fileHash],
  );
  return rows[0].total;
}

module.exports = { countByHash };
