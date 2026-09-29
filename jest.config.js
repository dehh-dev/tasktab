'use strict';

/**
 * Dois projetos, porque a suite tem duas naturezas.
 *
 * - `puros`: as funcoes puras de extracao, em `tests/services/`. Nao tocam
 *   banco nem HTTP, entao nao carregam o ciclo de integracao — com ele, cada
 *   caso pagava ~40 ms de fila, TRUNCATE e usuario padrao, e ainda exigia
 *   Docker e API no ar para testar um parser.
 * - `integracao`: todo o resto, falando HTTP com a API de verdade contra o
 *   banco de verdade. Pasta nova de teste cai aqui por padrao, que e o lado
 *   seguro: um teste de integracao sem o setup quebraria sem dizer por que.
 */
module.exports = {
  testTimeout: 15000,
  collectCoverageFrom: ['src/**/*.js', 'infra/**/*.js'],
  projects: [
    {
      displayName: 'puros',
      testEnvironment: 'node',
      clearMocks: true,
      testMatch: ['<rootDir>/tests/services/**/*.test.js'],
    },
    {
      displayName: 'integracao',
      testEnvironment: 'node',
      clearMocks: true,
      globalSetup: '<rootDir>/tests/global-setup.js',
      setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
      testMatch: ['<rootDir>/tests/**/*.test.js'],
      testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/services/'],
    },
  ],
};
