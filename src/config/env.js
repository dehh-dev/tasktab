'use strict';

const path = require('path');
const dotenv = require('dotenv');

const nodeEnv = process.env.NODE_ENV || 'development';

// dotenv nao sobrescreve variaveis ja definidas em process.env. Em producao o
// arquivo simplesmente nao existe e as variaveis reais do ambiente prevalecem.
dotenv.config({ path: path.resolve(__dirname, '../..', `env.${nodeEnv}`) });

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variavel de ambiente obrigatoria ausente: ${name} (NODE_ENV=${nodeEnv})`,
    );
  }
  return value;
}

const MINUTE = 60 * 1000;

module.exports = {
  nodeEnv,
  isTest: nodeEnv === 'test',
  port: Number(process.env.PORT || 3000),
  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * MINUTE),
    // Leitura e generosa: a interface recarrega a lista a cada mutacao.
    max: Number(process.env.RATE_LIMIT_MAX || 600),
    // Escrita e o que interessa conter.
    writeMax: Number(process.env.RATE_LIMIT_WRITE_MAX || 100),
    // Prestacao de contas trabalha em lote: um relatorio de 30 cupons sao
    // dezenas de escritas seguidas, feitas por uma pessoa so.
    batchWriteMax: Number(process.env.RATE_LIMIT_BATCH_WRITE_MAX || 600),
  },
  upload: {
    // Relativo a raiz do projeto quando nao absoluto. Em container e um volume:
    // a imagem nao carrega arquivo de usuario.
    dir: path.resolve(__dirname, '../..', process.env.UPLOAD_DIR || 'uploads'),
    maxBytes: Number(process.env.UPLOAD_MAX_BYTES || 20 * 1024 * 1024),
    maxFiles: Number(process.env.UPLOAD_MAX_FILES || 20),
  },
  database: {
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT || 5432),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    name: required('DB_NAME'),
  },
};
