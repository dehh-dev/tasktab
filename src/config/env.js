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

module.exports = {
  nodeEnv,
  isTest: nodeEnv === 'test',
  port: Number(process.env.PORT || 3000),
  database: {
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT || 5432),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    name: required('DB_NAME'),
  },
};
