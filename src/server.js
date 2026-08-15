'use strict';

const app = require('./app');
const env = require('./config/env');
const db = require('./config/database');
const { logger } = require('../infra/logger');

const server = app.listen(env.port, () => {
  logger.info(
    { port: env.port, env: env.nodeEnv },
    `tasktab rodando em http://localhost:${env.port}`,
  );
});

function shutdown(signal) {
  logger.info({ signal }, 'encerrando');
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = server;
