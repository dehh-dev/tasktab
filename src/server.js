'use strict';

const app = require('./app');
const env = require('./config/env');
const db = require('./config/database');

const server = app.listen(env.port, () => {
  console.log(
    `tasktab rodando em http://localhost:${env.port} (${env.nodeEnv})`,
  );
});

function shutdown(signal) {
  console.log(`\n${signal} recebido, encerrando...`);
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = server;
