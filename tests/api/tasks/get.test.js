'use strict';

const { request, insertTask } = require('../../orchestrator');

describe('GET /api/tasks', () => {
  it('retorna lista vazia quando nao ha tarefas', async () => {
    const response = await request('GET', '/api/tasks');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.meta).toEqual({ total: 0, limit: 50, offset: 0 });
  });

  it('lista as tarefas existentes', async () => {
    await insertTask({ title: 'Primeira' });
    await insertTask({ title: 'Segunda' });

    const response = await request('GET', '/api/tasks');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta.total).toBe(2);
    expect(response.body.data.map((task) => task.title)).toEqual(
      expect.arrayContaining(['Primeira', 'Segunda']),
    );
  });

  it('filtra por status', async () => {
    await insertTask({ title: 'Pendente', status: 'pending' });
    await insertTask({ title: 'Concluida', status: 'done' });

    const response = await request('GET', '/api/tasks?status=done');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].title).toBe('Concluida');
    expect(response.body.meta.total).toBe(1);
  });

  it('filtra o que aguarda outra pessoa, separado do pendente (issue 74)', async () => {
    await insertTask({ title: 'Faturas para lancar', status: 'pending' });
    await insertTask({ title: 'Voucher do veiculo', status: 'waiting' });

    const response = await request('GET', '/api/tasks?status=waiting');

    expect(response.status).toBe(200);
    expect(response.body.data.map((task) => task.title)).toEqual([
      'Voucher do veiculo',
    ]);
    expect(response.body.meta.total).toBe(1);
  });

  it('rejeita status invalido no filtro', async () => {
    const response = await request('GET', '/api/tasks?status=archived');

    expect(response.status).toBe(422);
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'status' }),
    );
  });

  it('ordena pelo prazo: o que vence primeiro, sem prazo no fim e, no mesmo prazo, a mais nova (issue 74)', async () => {
    await insertTask({ title: 'Sem prazo, antiga' });
    await insertTask({ title: 'Vence depois', due_date: '2026-11-20' });
    await insertTask({ title: 'Vence primeiro', due_date: '2026-11-10' });
    await insertTask({ title: 'Mesmo prazo, antiga', due_date: '2026-11-15' });
    await insertTask({ title: 'Mesmo prazo, nova', due_date: '2026-11-15' });
    await insertTask({ title: 'Sem prazo, nova' });

    const response = await request('GET', '/api/tasks');

    expect(response.body.data.map((task) => task.title)).toEqual([
      'Vence primeiro',
      'Mesmo prazo, nova',
      'Mesmo prazo, antiga',
      'Vence depois',
      'Sem prazo, nova',
      'Sem prazo, antiga',
    ]);

    // A pagina segue a mesma ordem.
    const page = await request('GET', '/api/tasks?limit=2&offset=1');
    expect(page.body.data.map((task) => task.title)).toEqual([
      'Mesmo prazo, nova',
      'Mesmo prazo, antiga',
    ]);
  });

  it('a busca q acha no titulo ou na referencia, sem caixa, e a contagem acompanha (issue 74)', async () => {
    const fatura = await request('POST', '/api/tasks', {
      title: 'Lancar no UAU',
      reference: 'Fatura 62502',
    });
    await request('POST', '/api/tasks', {
      title: 'Cobrar a FATURA da Movida',
      status: 'waiting',
    });
    await request('POST', '/api/tasks', {
      title: 'Vouchers de Rio Largo',
      reference: 'EMP 363',
    });

    const byReference = await request('GET', '/api/tasks?q=62502');
    const byBoth = await request('GET', '/api/tasks?q=fatura');
    const withStatus = await request(
      'GET',
      '/api/tasks?q=fatura&status=waiting',
    );
    const empty = await request('GET', '/api/tasks?q=%20');

    expect(byReference.body.data.map((task) => task.id)).toEqual([
      fatura.body.data.id,
    ]);
    expect(byBoth.body.data.map((task) => task.title).sort()).toEqual([
      'Cobrar a FATURA da Movida',
      'Lancar no UAU',
    ]);
    expect(byBoth.body.meta.total).toBe(2);
    expect(withStatus.body.data.map((task) => task.title)).toEqual([
      'Cobrar a FATURA da Movida',
    ]);
    expect(withStatus.body.meta.total).toBe(1);
    // Busca so de espaco e sem filtro.
    expect(empty.body.meta.total).toBe(3);
  });

  it('% e _ na busca valem como texto, e nao como curinga', async () => {
    await request('POST', '/api/tasks', { title: 'Desconto de 10% na fatura' });
    await request('POST', '/api/tasks', { title: 'Desconto de 100 reais' });
    await request('POST', '/api/tasks', { title: 'nota_fiscal pendente' });
    await request('POST', '/api/tasks', { title: 'notaXfiscal' });

    const percent = await request('GET', '/api/tasks?q=10%25');
    const underscore = await request('GET', '/api/tasks?q=nota_fiscal');

    expect(percent.body.data.map((task) => task.title)).toEqual([
      'Desconto de 10% na fatura',
    ]);
    expect(underscore.body.data.map((task) => task.title)).toEqual([
      'nota_fiscal pendente',
    ]);
  });

  it('respeita limit e offset', async () => {
    await insertTask({ title: 'A' });
    await insertTask({ title: 'B' });
    await insertTask({ title: 'C' });

    const response = await request('GET', '/api/tasks?limit=2&offset=1');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta).toEqual({ total: 3, limit: 2, offset: 1 });
  });
});

describe('GET /api/tasks/:id', () => {
  it('retorna a tarefa solicitada', async () => {
    const created = await insertTask({
      title: 'Detalhar tarefa',
      description: 'com descricao',
      status: 'in_progress',
      due_date: '2026-12-31',
    });

    const response = await request('GET', `/api/tasks/${created.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: created.id,
      title: 'Detalhar tarefa',
      description: 'com descricao',
      status: 'in_progress',
      due_date: '2026-12-31',
    });
  });
});
