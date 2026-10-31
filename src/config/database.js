'use strict';

const { Pool, types } = require('pg');
const env = require('./env');
const { logger } = require('../../infra/logger');

// Colunas DATE (OID 1082) chegam como string 'YYYY-MM-DD'. Sem isso o driver
// converte para Date na timezone local e a data pode "andar" um dia.
const PG_DATE_OID = 1082;
types.setTypeParser(PG_DATE_OID, (value) => value);

// O mesmo para `date[]` (OID 1182, os feriados do lancamento do RPA): o
// parser padrao do array chama o de data para cada item e volta a criar
// `Date`. O de `text[]` (OID 1009) devolve as strings como vieram.
const PG_DATE_ARRAY_OID = 1182;
const PG_TEXT_ARRAY_OID = 1009;
types.setTypeParser(PG_DATE_ARRAY_OID, types.getTypeParser(PG_TEXT_ARRAY_OID));

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
  logger.error({ err: error }, 'erro inesperado em cliente ocioso do pool');
});

/**
 * Executa uma query parametrizada. Usar sempre placeholders ($1, $2, ...)
 * para evitar SQL injection.
 */
function query(text, params) {
  return pool.query(text, params);
}

/**
 * Como `query`, mas com teto de tempo aplicado no servidor. Um Postgres que
 * aceita conexao e nao responde seguraria o chamador indefinidamente — o
 * `connectionTimeoutMillis` do pool cobre o handshake, nao a consulta.
 *
 * O `SET LOCAL` vale so ate o fim da transacao, entao a conexao volta ao pool
 * sem o teto grudado nela.
 */
async function queryWithTimeout(text, params, timeoutMs) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = ${Number(timeoutMs)}`);
    const result = await client.query(text, params);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Roda `work(client)` numa transacao: COMMIT se ela termina, ROLLBACK se
 * estoura. Quem escreve em mais de uma tabela de uma vez (o lancamento do RPA
 * com horario e diarias, a importacao da equipe) passa por aqui, para nao
 * sobrar metade gravada.
 */
async function transaction(work) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function close() {
  return pool.end();
}

module.exports = { pool, query, queryWithTimeout, transaction, close };
