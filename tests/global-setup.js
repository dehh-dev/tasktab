'use strict';

process.env.NODE_ENV = 'test';

const orchestrator = require('./orchestrator');

/**
 * Roda uma vez por execucao da suite, antes de qualquer arquivo de teste.
 *
 * Aqui ficam as tarefas caras e idempotentes: esperar a API subir (o `npm test`
 * a levanta em paralelo ao Jest) e aplicar as migrations. Deixar isso no
 * `beforeAll` de cada arquivo custaria um `npx node-pg-migrate` por arquivo.
 */
module.exports = async function globalSetup() {
  await orchestrator.waitForAllServices();
  orchestrator.runPendingMigrations();
  await orchestrator.closeDatabase();
};
