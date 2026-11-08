'use strict';

const {
  request,
  insertTask,
  enumLabels,
  runMigration,
  migrationsFrom,
} = require('../orchestrator');

/**
 * Os status da tarefa (issue 74): `waiting` separa o que espera outra pessoa
 * da fila de quem faz.
 */
describe('status da tarefa', () => {
  it('pendente, em andamento, aguardando e concluida, nessa ordem', async () => {
    expect(await enumLabels('task_status')).toEqual([
      'pending',
      'in_progress',
      'waiting',
      'done',
    ]);
  });
});

// O Postgres nao remove valor de enum: o `down` recria o tipo, e o que estava
// aguardando volta para pendente. O teste volta da ultima migration ate ela,
// confere e reaplica num `finally`, como o das categorias de despesa.
describe('migration add-task-status-waiting', () => {
  it('o down devolve a pendente o que aguardava, e o up volta a aceitar', async () => {
    const waiting = await insertTask({
      title: 'Voucher do veiculo',
      status: 'waiting',
    });
    const doing = await insertTask({
      title: 'Faturas do UAU',
      status: 'in_progress',
    });
    const ate = migrationsFrom('1794171120814_add-task-status-waiting');

    try {
      runMigration('down', ate);
      expect(await enumLabels('task_status')).toEqual([
        'pending',
        'in_progress',
        'done',
      ]);
    } finally {
      runMigration('up', ate);
    }

    const back = await request('GET', `/api/tasks/${waiting.id}`);
    const kept = await request('GET', `/api/tasks/${doing.id}`);
    expect(back.body.data.status).toBe('pending');
    expect(kept.body.data.status).toBe('in_progress');

    const again = await request('PATCH', `/api/tasks/${waiting.id}`, {
      status: 'waiting',
    });
    expect(again.status).toBe(200);
    expect(again.body.data.status).toBe('waiting');
  }, 60000);
});
