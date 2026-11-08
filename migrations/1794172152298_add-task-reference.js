'use strict';

/**
 * `tasks.reference` (issue 74): de onde a tarefa veio ou o que a identifica
 * fora daqui — "Fatura 62502", "EMP 363", "Processo UAU 164". Numero de
 * fatura e link de e-mail iam parar na descricao, e nao dava para saber se
 * uma fatura ja estava cadastrada. Opcional; a busca `q` le daqui e do titulo.
 */
exports.up = (pgm) => {
  pgm.addColumn('tasks', {
    reference: { type: 'varchar(120)' },
  });

  // Complementa o validador, como o titulo: vazio e sem referencia (null).
  pgm.addConstraint('tasks', 'tasks_reference_not_blank', {
    check: "reference IS NULL OR btrim(reference) <> ''",
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('tasks', 'reference');
};
