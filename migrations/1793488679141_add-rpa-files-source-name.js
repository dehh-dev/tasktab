'use strict';

/**
 * O nome da conta Google de quem mandou o documento (issue 41). E o que vem
 * no nome do arquivo baixado do Drive (`<nome original> - <nome da conta>`) e
 * o que casa o documento com a pessoa. Quando nao casa, e o que a tela mostra
 * para alguem escolher a pessoa na mao.
 *
 * Nome de terceiro: fica no banco como os outros dados da equipe, e nunca no
 * log.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('rpa_files', {
    source_name: { type: 'varchar(255)' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('rpa_files', 'source_name');
};
