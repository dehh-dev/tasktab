'use strict';

// Escopos ja em uso no historico. Manter a lista curta e explicita evita que
// cada commit invente um escopo novo.
const SCOPES = [
  'api',
  'web',
  'db',
  'http',
  'config',
  'infra',
  'scripts',
  'validation',
  'lint',
  'deps',
  // Aba de prestacao de contas
  'reports',
  'receipts',
  'merchants',
  'extracao',
  'export',
  'upload',
];

module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [2, 'always', SCOPES],
  },
};
