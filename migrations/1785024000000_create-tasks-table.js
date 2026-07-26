'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createType('task_status', ['pending', 'in_progress', 'done']);

  pgm.createTable('tasks', {
    id: 'id',
    title: { type: 'varchar(255)', notNull: true },
    description: { type: 'text' },
    status: { type: 'task_status', notNull: true, default: 'pending' },
    due_date: { type: 'date' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // Impede titulos compostos so de espaco em branco, complementando a
  // validacao da camada de aplicacao.
  pgm.addConstraint('tasks', 'tasks_title_not_blank', {
    check: "btrim(title) <> ''",
  });

  pgm.createIndex('tasks', 'status');
  pgm.createIndex('tasks', 'due_date');
};

exports.down = (pgm) => {
  pgm.dropTable('tasks');
  pgm.dropType('task_status');
};
