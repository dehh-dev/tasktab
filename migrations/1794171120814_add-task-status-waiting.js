'use strict';

/**
 * Status `waiting` nas tarefas (issue 74): separa o que depende de mim do que
 * espera outra pessoa (o voucher do veiculo, a resposta sobre o insumo), que
 * ficava em `pending` misturado com o resto. Vem depois de `in_progress`.
 *
 * O `up` so acrescenta o valor. O Postgres nao remove valor de enum, entao o
 * `down` recria o tipo, como as migrations de categoria de despesa: antes, o
 * que esta em `waiting` volta a `pending`, a fila de onde saiu. Voltar atras
 * custa a marca de "aguardando", nao a tarefa.
 */

const STATUSES = ['pending', 'in_progress', 'done'];

exports.up = (pgm) => {
  pgm.addTypeValue('task_status', 'waiting', { after: 'in_progress' });
};

exports.down = (pgm) => {
  pgm.sql("UPDATE tasks SET status = 'pending' WHERE status = 'waiting'");

  // O DEFAULT de `tasks.status` cita o tipo antigo e impede o ALTER TYPE:
  // cai antes e volta depois.
  pgm.sql('ALTER TYPE task_status RENAME TO task_status_old');
  pgm.createType('task_status', STATUSES);
  pgm.sql('ALTER TABLE tasks ALTER COLUMN status DROP DEFAULT');
  pgm.sql(`ALTER TABLE tasks
             ALTER COLUMN status TYPE task_status
             USING status::text::task_status`);
  pgm.sql(
    "ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'pending'::task_status",
  );
  pgm.dropType('task_status_old');
};
