'use strict';

process.env.NODE_ENV = 'test';

const orchestrator = require('../tests/orchestrator');

/**
 * Prepara o banco de teste antes da suite de E2E, reaproveitando o mesmo
 * orchestrator da suite de API. Os servidores sao levantados pelo `webServer`
 * do playwright.config.js.
 */
module.exports = async function globalSetup() {
  orchestrator.runPendingMigrations();
  await orchestrator.closeDatabase();
};
