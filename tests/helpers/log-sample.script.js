'use strict';

/**
 * Loga uma linha com dado pessoal pelo logger de verdade e sai. O teste
 * (`tests/infra/logger.test.js`) le o que foi para a saida padrao: e o mesmo
 * caminho de um log em producao, sem nada trocado no meio.
 *
 * Os valores sao sinteticos, calculados pelo verificador.
 */
const { logger } = require('../../infra/logger');

logger.info(
  {
    cpf: '11144477735',
    raw_text: 'CONSUMIDOR CPF 529.982.247-25',
    worker: {
      id: 7,
      cpf: '52998224725',
      pis: '12056412545',
      rg: '123456789',
      agency: '0001',
      account: '1234567-8',
      pix_key: 'pessoa@exemplo.com',
    },
  },
  'amostra de log',
);
