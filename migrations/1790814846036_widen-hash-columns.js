'use strict';

/**
 * Folga nas colunas de hash.
 *
 * O SHA-256 em hex tem exatamente 64 caracteres, e `varchar(64)` nao deixava
 * margem nenhuma: trocar o algoritmo por um de saida maior (SHA-512 da 128)
 * estouraria a coluna no primeiro INSERT. Alargar um `varchar` no Postgres e
 * so metadado — nao reescreve a tabela.
 *
 * CNPJ (14) e chave de acesso (44) ficam como estao: o tamanho e da norma, nao
 * de uma escolha nossa, e o CNPJ alfanumerico de 2026 manteve os 14.
 */
const COLUMNS = [
  ['sessions', 'token_hash'],
  ['receipts', 'file_hash'],
];

exports.up = (pgm) => {
  for (const [table, column] of COLUMNS) {
    pgm.alterColumn(table, column, { type: 'varchar(128)' });
  }
};

exports.down = (pgm) => {
  for (const [table, column] of COLUMNS) {
    pgm.alterColumn(table, column, { type: 'varchar(64)' });
  }
};
