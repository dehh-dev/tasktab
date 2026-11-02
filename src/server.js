'use strict';

const app = require('./app');
const env = require('./config/env');
const db = require('./config/database');
const { logger } = require('../infra/logger');
const ocr = require('./services/extraction/ocr.service');
const { startRetentionSweep } = require('./services/rpa/retention.service');

let stopRetention = () => {};

const server = app.listen(env.port, () => {
  logger.info(
    { port: env.port, env: env.nodeEnv },
    `tasktab rodando em http://localhost:${env.port}`,
  );
  // A retencao do RPA (um mes depois de encerrar) roda dentro da API, sem
  // depender de cron: a API e o processo que fica no ar.
  stopRetention = startRetentionSweep(logger);
});

function shutdown(signal) {
  logger.info({ signal }, 'encerrando');
  stopRetention();
  server.close(async () => {
    // O worker do tesseract e um processo filho: sem encerrar, o node nao sai.
    await ocr.shutdown();
    await db.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = server;
