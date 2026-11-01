'use strict';

const { enumLabels, runMigration, migrationsFrom } = require('../orchestrator');
const db = require('../../src/config/database');

async function rpaObjects() {
  const { rows } = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM pg_type
        WHERE typname LIKE 'rpa\\_%' AND typtype = 'e') AS enums,
       (SELECT COUNT(*)::int FROM information_schema.tables
        WHERE table_name LIKE 'rpa\\_%') AS tables,
       (SELECT COUNT(*)::int FROM pg_proc
        WHERE proname LIKE 'rpa\\_%') AS functions`,
  );
  return rows[0];
}

/**
 * `down` e `up` das migrations do RPA, de verdade: o `down` tem de desfazer
 * tudo, inclusive os enums — `dropTable` nao leva tipo nenhum, e um enum
 * esquecido faz o `up` seguinte estourar com "type already exists".
 *
 * Volta da ultima migration ate a do schema, e nao so ela (`migrationsFrom`):
 * reaplicada fora de ordem, o node-pg-migrate recusaria a proxima execucao.
 */
describe('migrations do RPA', () => {
  it('o down remove tabelas, enums e funcoes, e o up recria tudo', async () => {
    const ate = migrationsFrom('1793470275082_create-rpa-tables');
    let removed;

    try {
      runMigration('down', ate);
      removed = await rpaObjects();
    } finally {
      runMigration('up', ate);
    }

    expect(removed).toEqual({ enums: 0, tables: 0, functions: 0 });
    // A que anula os dias do cancelado e as tres travas do RPA emitido.
    expect(await rpaObjects()).toEqual({ enums: 10, tables: 13, functions: 4 });
    expect(await enumLabels('rpa_adjustment_kind')).toEqual([
      'bonus',
      'addition',
      'deduction',
    ]);
  }, 60000);
});
