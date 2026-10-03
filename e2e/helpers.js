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
    // Fechado recusa o DELETE com 409: reabre antes, senao o relatorio de uma
    // spec que o fechou sobraria para a seguinte.
    if (report.status === 'closed') {
      await request.patch(`/api/reports/${report.id}`, {
        data: { status: 'open' },
      });
    }

    await request.delete(`/api/reports/${report.id}`);
  }

  // Emitente nao tem DELETE, e o E2E nao trunca o banco. Confirmar um cupom
  // grava a categoria no emitente (caixa marcada por padrao), e sem isto a
  // spec seguinte receberia o CNPJ ja classificado: o palpite sumia da tela.
  const merchants = await readData(
    await request.get('/api/merchants?limit=100'),
    'listar emitentes',
  );

  for (const merchant of merchants) {
    if (merchant.default_category !== 'nao_classificado') {
      await request.patch(`/api/merchants/${merchant.id}`, {
        data: { default_category: 'nao_classificado' },
      });
    }
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

/**
 * Poe os PDFs no relatorio pela API e espera a extracao terminar, antes de a
 * pagina abrir.
 *
 * Subir pela tela so vale nas specs cujo assunto e o proprio upload. Nas
 * outras ele e preparo, e ir pela tela obrigava a esperar o poll de 1,5 s da
 * `ReportDetail`: quase dois segundos por spec, em mais da metade da suite.
 * Vai numa requisicao so, no campo `files`, como a tela manda.
 */
async function addReceipts(request, reportId, buffers) {
  await sendReceipts(request, reportId, buffers);
  return waitForReceipts(request, reportId);
}

/**
 * Poe os PDFs no relatorio pela API e volta logo, com a extracao ainda
 * rodando. So para as specs cujo assunto e o acompanhamento do processamento;
 * nas outras, `addReceipts`.
 */
async function sendReceipts(request, reportId, buffers) {
  const form = new FormData();

  buffers.forEach((buffer, index) => {
    form.append(
      'files',
      new Blob([buffer], { type: 'application/pdf' }),
      `cupom-${index}.pdf`,
    );
  });

  const response = await request.post(`/api/reports/${reportId}/receipts`, {
    multipart: form,
  });

  return readData(response, 'enviar comprovantes');
}

/** Espera nenhum comprovante do relatorio estar mais na fila de extracao. */
async function waitForReceipts(request, reportId, { timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await request.get(`/api/reports/${reportId}/receipts`);
    const receipts = await readData(response, 'listar comprovantes');
    const settled = receipts.every(
      (receipt) =>
        receipt.status !== 'pending' && receipt.status !== 'processing',
    );

    if (settled) {
      return receipts;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `arranjo falhou: a extracao do relatorio ${reportId} nao terminou`,
  );
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
  addReceipts,
  sendReceipts,
  createUser,
  deleteUser,
};
