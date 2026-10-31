'use strict';

const db = require('../config/database');

/** A lista do Banco Central, semeada na migration. So leitura. */
async function findAll() {
  const { rows } = await db.query(
    'SELECT code, short_name, name FROM rpa_banks ORDER BY code',
  );
  return rows;
}

async function exists(code) {
  const { rows } = await db.query('SELECT 1 FROM rpa_banks WHERE code = $1', [
    code,
  ]);
  return rows.length > 0;
}

module.exports = { findAll, exists };
