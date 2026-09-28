'use strict';

const path = require('path');

/**
 * Onde o cookie de sessao do E2E e guardado entre o projeto de setup e as
 * specs. Fora do versionamento: e uma credencial, ainda que de um usuario de
 * teste num banco descartavel.
 */
const STORAGE_STATE = path.resolve(__dirname, '../test-results/.auth.json');

/**
 * O usuario do E2E e administrador porque os helpers limpam **todos** os
 * relatorios entre as specs, inclusive os sem dono. Com um papel comum a
 * limpeza so alcancaria os proprios e uma spec herdaria o estado da anterior.
 */
const E2E_USER = {
  name: 'Playwright',
  email: 'e2e@tasktab.test',
  password: 'senha-do-e2e-123',
  role: 'admin',
};

module.exports = { STORAGE_STATE, E2E_USER };
