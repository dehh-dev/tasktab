'use strict';

const { request, insertReport, insertReceipt } = require('../../orchestrator');

describe('GET /api/reports/:id/receipts', () => {
  it('lista vazia quando o relatorio nao tem comprovantes', async () => {
    const report = await insertReport();

    const response = await request(`GET`, `/api/reports/${report.id}/receipts`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.meta.total).toBe(0);
    expect(response.body.meta.total_cents).toBe(0);
  });

  it('ordena por data, com a pagina como desempate', async () => {
    const report = await insertReport();

    await insertReceipt(report.id, {
      issued_at: '2026-06-20',
      page_number: 1,
      file_hash: 'b'.repeat(64),
    });
    await insertReceipt(report.id, { issued_at: '2026-06-10', page_number: 2 });
    await insertReceipt(report.id, { issued_at: '2026-06-10', page_number: 1 });

    const response = await request('GET', `/api/reports/${report.id}/receipts`);

    expect(
      response.body.data.map((receipt) => [
        receipt.issued_at,
        receipt.page_number,
      ]),
    ).toEqual([
      ['2026-06-10', 1],
      ['2026-06-10', 2],
      ['2026-06-20', 1],
    ]);
  });

  it('mantem o que ainda nao tem data no fim da lista', async () => {
    const report = await insertReport();

    await insertReceipt(report.id, { page_number: 1, issued_at: null });
    await insertReceipt(report.id, { page_number: 2, issued_at: '2026-06-10' });

    const response = await request('GET', `/api/reports/${report.id}/receipts`);

    // O que ainda nao foi extraido nao pode sumir no meio da lista.
    expect(response.body.data.map((receipt) => receipt.issued_at)).toEqual([
      '2026-06-10',
      null,
    ]);
  });

  it('filtra por status e por categoria', async () => {
    const report = await insertReport();

    await insertReceipt(report.id, {
      page_number: 1,
      status: 'confirmed',
      category: 'alimentacao',
      amount_cents: 3760,
      issued_at: '2026-06-19',
    });
    await insertReceipt(report.id, { page_number: 2, status: 'pending' });

    const porStatus = await request(
      'GET',
      `/api/reports/${report.id}/receipts?status=confirmed`,
    );
    expect(porStatus.body.data).toHaveLength(1);

    const porCategoria = await request(
      'GET',
      `/api/reports/${report.id}/receipts?category=alimentacao`,
    );
    expect(porCategoria.body.data).toHaveLength(1);
  });

  it('soma o total e o subtotal por categoria em centavos', async () => {
    const report = await insertReport();

    await insertReceipt(report.id, {
      page_number: 1,
      category: 'alimentacao',
      amount_cents: 3760,
      status: 'confirmed',
    });
    await insertReceipt(report.id, {
      page_number: 2,
      category: 'alimentacao',
      amount_cents: 4860,
      status: 'confirmed',
    });
    await insertReceipt(report.id, {
      page_number: 3,
      category: 'transporte',
      amount_cents: 2436,
      status: 'confirmed',
    });

    const response = await request('GET', `/api/reports/${report.id}/receipts`);

    expect(response.body.meta.total).toBe(3);
    expect(response.body.meta.total_cents).toBe(11056);
    expect(response.body.meta.by_category).toEqual({
      alimentacao: 8620,
      transporte: 2436,
    });
  });

  it('duplicata continua listada mas fora do somatorio', async () => {
    const report = await insertReport();

    await insertReceipt(report.id, {
      page_number: 1,
      category: 'alimentacao',
      amount_cents: 4860,
      status: 'confirmed',
    });
    await insertReceipt(report.id, {
      page_number: 2,
      category: 'alimentacao',
      amount_cents: 4860,
      status: 'duplicate',
    });

    const response = await request('GET', `/api/reports/${report.id}/receipts`);

    // Somar as duas seria recriar o erro que a ferramenta existe para evitar.
    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta.total_cents).toBe(4860);
  });

  it('rejeita categoria invalida no filtro', async () => {
    const report = await insertReport();

    const response = await request(
      'GET',
      `/api/reports/${report.id}/receipts?category=cinema`,
    );

    expect(response.status).toBe(422);
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'category' }),
    );
  });

  it('retorna 404 para relatorio inexistente', async () => {
    const response = await request('GET', '/api/reports/999999/receipts');

    expect(response.status).toBe(404);
  });
});

describe('GET /api/receipts/:id', () => {
  it('retorna o comprovante solicitado', async () => {
    const report = await insertReport();
    const created = await insertReceipt(report.id, { amount_cents: 5980 });

    const response = await request('GET', `/api/receipts/${created.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: created.id,
      report_id: report.id,
      amount_cents: 5980,
    });
  });

  it('retorna 404 para id inexistente', async () => {
    const response = await request('GET', '/api/receipts/999999');

    expect(response.status).toBe(404);
    expect(response.body.name).toBe('NotFoundError');
  });
});
