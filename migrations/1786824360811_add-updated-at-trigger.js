'use strict';

exports.shorthands = undefined;

const FUNCTION_NAME = 'set_updated_at';
const TRIGGER_NAME = 'tasks_set_updated_at';

// Ate aqui, `updated_at` era responsabilidade do model: quem escrevesse por
// fora (seed, psql, uma migration futura) deixava o campo mentir. Com o
// trigger a garantia passa a ser do banco, onde ninguem escapa dela.
exports.up = (pgm) => {
  pgm.createFunction(
    FUNCTION_NAME,
    [],
    { returns: 'trigger', language: 'plpgsql', replace: true },
    `
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    `,
  );

  pgm.createTrigger('tasks', TRIGGER_NAME, {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: FUNCTION_NAME,
  });
};

exports.down = (pgm) => {
  pgm.dropTrigger('tasks', TRIGGER_NAME);
  pgm.dropFunction(FUNCTION_NAME, []);
};
