'use strict';

const { Pool, types } = require('pg');
const env = require('./env');

// Colunas DATE (OID 1082) chegam como string 'YYYY-MM-DD'. Sem isso o driver
// converte para Date na timezone local e a data pode "andar" um dia.
const PG_DATE_OID = 1082;
types.setTypeParser(PG_DATE_OID, (value) => value);

const pool = new Pool({
  host: env.database.host,
  port: env.database.port,
  user: env.database.user,
  password: env.database.password,
  database: env.database.name,
  max: env.isTest ? 5 : 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (error) => {
  console.error('Erro inesperado em cliente ocioso do pool:', error);
});

/**
 * Executa uma query parametrizada. Usar sempre placeholders ($1, $2, ...)
 * para evitar SQL injection.
 */
function query(text, params) {
  return pool.query(text, params);
}

function close() {
  return pool.end();
}

module.exports = { pool, query, close };
