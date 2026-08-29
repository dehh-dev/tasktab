'use strict';

/**
 * Hora e numero do documento no comprovante, e a marca de categoria adivinhada.
 *
 * As tres colunas existem porque a planilha que este projeto substitui traz as
 * tres, e sem elas a exportacao continuava obrigando a conferir o cupom no
 * papel para preencher a mao o que ja estava no texto extraido.
 */
exports.up = (pgm) => {
  pgm.addColumns('receipts', {
    // `time` e nao `timestamp`: a data ja mora em `issued_at`, e juntar as duas
    // reintroduziria a conversao de timezone que o type parser do OID 1082
    // existe para evitar. O `pg` devolve `time` como string, sem passar por
    // Date.
    issued_time: { type: 'time', notNull: false },

    // O identificador impresso ("NFC-e 3210 / serie 012", "Recibo manuscrito
    // n 1996"). Texto livre de proposito: cada emitente imprime de um jeito, e
    // normalizar isso em colunas seria inventar um padrao que o papel nao tem.
    document_ref: { type: 'varchar(120)', notNull: false },

    // Categoria sugerida por palavra-chave no nome do emitente, ainda nao
    // confirmada por ninguem. A tela de revisao destaca o campo enquanto isto
    // for verdade; confirmar o comprovante zera a marca.
    category_guessed: { type: 'boolean', notNull: true, default: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('receipts', [
    'issued_time',
    'document_ref',
    'category_guessed',
  ]);
};
