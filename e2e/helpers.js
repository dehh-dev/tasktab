'use strict';

/**
 * O arranjo do E2E passa pela API publica, e nao pelo banco: manter um pool do
 * `pg` vivo dentro do worker do Playwright prenderia o processo no fim da
 * suite. Aqui a rota nao esta sob teste — a interface esta.
 */

/**
 * Le o corpo de uma resposta da API, falando alto quando ela nao veio OK.
 *
 * Sem isto, uma sessao expirada faz o arranjo receber 401, desestruturar
 * `data` como `undefined` e a spec quebrar com um TypeError que nao diz nada
 * sobre a causa. Ja custou uma investigacao.
 */
async function readData(response, what) {
  if (!response.ok()) {
    throw new Error(
      `arranjo falhou ao ${what}: HTTP ${response.status()} — ` +
        `a sessao do E2E pode nao estar valendo`,
    );
  }

  const { data } = await response.json();
  return data;
}

/** Remove todas as tarefas. Chamado antes de cada teste. */
async function clearTasks(request) {
  const response = await request.get('/api/tasks?limit=100');
  const data = await readData(response, 'listar tarefas');

  for (const task of data) {
    await request.delete(`/api/tasks/${task.id}`);
  }
}

/** Cria uma tarefa e devolve o corpo devolvido pela API. */
async function createTask(request, overrides = {}) {
  const response = await request.post('/api/tasks', {
    data: { title: 'Tarefa existente', ...overrides },
  });

  return readData(response, 'criar tarefa');
}

/** Remove todos os relatorios (e os comprovantes, via cascade). */
async function clearReports(request) {
  const response = await request.get('/api/reports?limit=100');
  const data = await readData(response, 'listar relatorios');

  for (const report of data) {
    await request.delete(`/api/reports/${report.id}`);
  }
}

/** Cria um relatorio e devolve o corpo devolvido pela API. */
async function createReport(request, overrides = {}) {
  const response = await request.post('/api/reports', {
    data: {
      title: 'Relatorio existente',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      ...overrides,
    },
  });

  return readData(response, 'criar relatorio');
}

/** Envia um PDF ao relatorio no campo `files`, o mesmo que a tela usa. */
async function uploadReceipt(request, reportId, buffer) {
  const response = await request.post(`/api/reports/${reportId}/receipts`, {
    multipart: {
      files: { name: 'cupom.pdf', mimeType: 'application/pdf', buffer },
    },
  });

  return readData(response, 'enviar comprovante');
}

/**
 * Cadastra uma pessoa e devolve o registro junto da senha, para entrar com
 * ela na tela. O e-mail leva sufixo unico porque o E2E nao trunca `users`:
 * um e-mail fixo quebraria a segunda execucao por cadastro repetido.
 */
async function createUser(request, overrides = {}) {
  const password = 'senha-do-e2e-123';
  const response = await request.post('/api/users', {
    data: {
      name: 'Pessoa do E2E',
      email: `pessoa-${Date.now()}-${Math.random().toString(36).slice(2)}@tasktab.test`,
      password,
      role: 'user',
      ...overrides,
    },
  });

  return { ...(await readData(response, 'cadastrar usuario')), password };
}

async function deleteUser(request, id) {
  await request.delete(`/api/users/${id}`);
}

module.exports = {
  clearTasks,
  createTask,
  clearReports,
  createReport,
  uploadReceipt,
  createUser,
  deleteUser,
};
