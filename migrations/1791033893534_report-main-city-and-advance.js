'use strict';

/**
 * Adiantamento "nao informado" e cidade principal da viagem (issue 44).
 *
 * O procedimento manda sinalizar adiantamento nao informado, porque sem ele
 * nao ha saldo a calcular. Com a coluna `NOT NULL DEFAULT 0`, o esquecido e o
 * "nao houve adiantamento" eram o mesmo zero. Agora nulo e "nao informado" e
 * zero e "nao houve". Os relatorios que ja existem ficam com o que tem: nao ha
 * como saber, de um zero gravado, qual dos dois ele era.
 *
 * A cidade principal e a base das regras da viagem (despesa fora dela, duas
 * cidades no mesmo dia), e cai no relatorio por ser uma so para a prestacao
 * inteira. Texto livre, como a cidade do comprovante.
 */
exports.up = (pgm) => {
  pgm.alterColumn('reports', 'advance_cents', {
    notNull: false,
    default: null,
  });
  pgm.addColumns('reports', {
    main_city: { type: 'varchar(255)' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('reports', ['main_city']);
  // Voltar exige escolher um valor para o nao informado, e o zero e o que a
  // coluna antiga ja usava para ele.
  pgm.sql('UPDATE reports SET advance_cents = 0 WHERE advance_cents IS NULL');
  pgm.alterColumn('reports', 'advance_cents', { notNull: true, default: 0 });
};
