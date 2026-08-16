'use strict';

const orchestrator = require('./orchestrator');

/**
 * Preambulo comum a todo arquivo de teste, registrado pelo `setupFilesAfterEnv`
 * do Jest. Evita repetir o mesmo bloco em cada arquivo — e garante que ninguem
 * esqueca de limpar o banco.
 *
 * O que e caro e roda uma vez so fica no `global-setup.js`.
 */
// Drenar antes de truncar: trabalho assincrono de um teste anterior escreveria
// no banco ja limpo do teste seguinte.
beforeEach(async () => {
  await orchestrator.waitForQueue();
  await orchestrator.clearDatabase();
});
afterAll(orchestrator.closeDatabase);
