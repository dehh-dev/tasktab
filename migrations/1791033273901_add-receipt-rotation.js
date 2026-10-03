'use strict';

/**
 * Rotacao escolhida na revisao, por comprovante (issue 43).
 *
 * "Pagina de cabeca para baixo. Acontece." O escaneamento do WhatsApp chega
 * com orientacao variada, e o OCR le a imagem como veio. A rotacao fica no
 * comprovante, e nao no arquivo: o PDF original e evidencia e nao se regrava.
 * Ela vale para a imagem da revisao, para o reprocessamento e para o PDF
 * consolidado, somada ao `/Rotate` que a pagina ja traga.
 *
 * Quarto de volta e o unico giro que nao reamostra a imagem — o check barra
 * o resto no banco, para toda escrita, e nao so na da API.
 */
exports.up = (pgm) => {
  pgm.addColumns('receipts', {
    rotation: { type: 'smallint', notNull: true, default: 0 },
  });
  pgm.addConstraint('receipts', 'receipts_rotation_quarter_turn', {
    check: 'rotation IN (0, 90, 180, 270)',
  });
};

exports.down = (pgm) => {
  // A constraint cai junto com a coluna.
  pgm.dropColumns('receipts', ['rotation']);
};
