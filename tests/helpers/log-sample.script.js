'use strict';

/**
 * Loga dado pessoal pelo logger de verdade e sai. O teste
 * (`tests/infra/logger.test.js`) le o que foi para a saida padrao: e o mesmo
 * caminho de um log em producao, sem nada trocado no meio.
 *
 * O erro e do Postgres de teste, provocado numa tabela temporaria: e o que o
 * `onError` loga quando uma constraint escapa da validacao.
 *
 * Os valores sao sinteticos, calculados pelo verificador.
 */
const db = require('../../src/config/database');
const { logger } = require('../../infra/logger');

async function main() {
  logger.info(
    {
      cpf: '11144477735',
      raw_text: 'CONSUMIDOR CPF 529.982.247-25',
      worker: {
        id: 7,
        cpf: '52998224725',
        pis: '12056412545',
        rg: '123456789',
        agency: '0001',
        account: '1234567-8',
        pix_key: 'pessoa@exemplo.com',
      },
    },
    'amostra de log',
  );

  const client = await db.pool.connect();

  try {
    await client.query(
      'CREATE TEMP TABLE log_sample (cpf text, n int CHECK (n > 0))',
    );
    await client.query("INSERT INTO log_sample VALUES ('52998224725', -1)");
  } catch (error) {
    logger.error({ err: error }, 'erro do banco');
  } finally {
    client.release();
    await db.close();
  }
}

main();
