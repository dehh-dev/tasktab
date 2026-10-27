'use strict';

/**
 * O que a extracao propos, guardado a parte do que a revisao confirmou.
 *
 * Data, valor e categoria sao uma coluna so, e a revisao grava por cima do
 * que a extracao leu: depois de confirmado, nao havia como saber se a leitura
 * estava certa. Num relatorio real, os 23 comprovantes sairam como `manual` e
 * a taxa de acerto so pode ser medida relendo o `raw_text`. Com a proposta
 * guardada, mede-se qualquer mudanca na extracao contra o que uma pessoa
 * conferiu.
 *
 * So a extracao escreve aqui (`EXTRACTION_COLUMNS`), nunca o `PATCH`. Nulo e
 * comprovante que nao passou pela extracao depois desta migration.
 */
exports.up = (pgm) => {
  pgm.addColumns('receipts', {
    extracted: { type: 'jsonb' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('receipts', ['extracted']);
};
