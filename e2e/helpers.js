'use strict';

/**
 * O arranjo do E2E passa pela API publica, e nao pelo banco: manter um pool do
 * `pg` vivo dentro do worker do Playwright prenderia o processo no fim da
 * suite. Aqui a rota nao esta sob teste — a interface esta.
 */

/** Remove todas as tarefas. Chamado antes de cada teste. */
async function clearTasks(request) {
  const response = await request.get('/api/tasks?limit=100');
  const { data } = await response.json();

  for (const task of data) {
    await request.delete(`/api/tasks/${task.id}`);
  }
}

/** Cria uma tarefa e devolve o corpo devolvido pela API. */
async function createTask(request, overrides = {}) {
  const response = await request.post('/api/tasks', {
    data: { title: 'Tarefa existente', ...overrides },
  });

  const { data } = await response.json();
  return data;
}

module.exports = { clearTasks, createTask };
