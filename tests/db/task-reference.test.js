'use strict';

const { insertTask, updateColumnDirectly } = require('../orchestrator');

/**
 * `tasks.reference` (issue 74): o banco complementa o validador, como no
 * titulo, para valer tambem para escrita que nao passa pela API.
 */
describe('tasks.reference', () => {
  it('recusa referencia so de espaco e com mais de 120 caracteres', async () => {
    const task = await insertTask();

    await expect(
      updateColumnDirectly('tasks', task.id, 'reference', '   '),
    ).rejects.toThrow(/tasks_reference_not_blank/);
    await expect(
      updateColumnDirectly('tasks', task.id, 'reference', 'x'.repeat(121)),
    ).rejects.toThrow(/too long/);
    await expect(
      updateColumnDirectly('tasks', task.id, 'reference', 'Fatura 62502'),
    ).resolves.toBeDefined();
  });
});
