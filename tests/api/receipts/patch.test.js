'use strict';

const { request, insertReport, insertReceipt } = require('../../orchestrator');

const COMPLETO = {
  issued_at: '2026-06-19',
  amount_cents: 3760,
  category: 'alimentacao',
};

describe('PATCH /api/receipts/:id', () => {
  it('corrige os campos da revisao', async () => {
    const report = await insertReport();
    const receipt = await insertReceipt(report.id);

    const response = await request(
      'PATCH',
      `/api/receipts/${receipt.id}`,
      COMPLETO,
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject(COMPLETO);
  });

  it('marca a origem como manual ao corrigir a mao', async () => {
    const report = await insertReport();
    const receipt = await insertReceipt(report.id);

    const response = await request('PATCH', `/api/receipts/${receipt.id}`, {
      amount_cents: 5980,
    });

    // E o que permite a revisao destacar o que veio de OCR e o que ja foi
    // olhado por uma pessoa.
    expect(response.body.data.extraction_source).toBe('manual');
  });

  it('confirma quando data, valor e categoria estao preenchidos', async () => {
    const report = await insertReport();
    const receipt = await insertReceipt(report.id);

    const response = await request('PATCH', `/api/receipts/${receipt.id}`, {
      ...COMPLETO,
      status: 'confirmed',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('confirmed');
  });

  it('confirma usando o que ja estava gravado', async () => {
    const report = await insertReport();
    const receipt = await insertReceipt(report.id, COMPLETO);

    const response = await request('PATCH', `/api/receipts/${receipt.id}`, {
      status: 'confirmed',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('confirmed');
  });

  it('recusa confirmar sem valor', async () => {
    const report = await insertReport();
    const receipt = await insertReceipt(report.id, {
      issued_at: '2026-06-19',
      category: 'alimentacao',
    });

    const response = await request('PATCH', `/api/receipts/${receipt.id}`, {
      status: 'confirmed',
    });

    expect(response.status).toBe(422);
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'amount_cents' }),
    );
  });

  it('recusa confirmar sem data nem categoria, apontando os dois campos', async () => {
    const report = await insertReport();
    const receipt = await insertReceipt(report.id, { amount_cents: 3760 });

    const response = await request('PATCH', `/api/receipts/${receipt.id}`, {
      status: 'confirmed',
    });

    expect(response.status).toBe(422);
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'issued_at' }),
    );
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'category' }),
    );
  });

  it('rejeita valor em reais, que nao e inteiro de centavos', async () => {
    const report = await insertReport();
    const receipt = await insertReceipt(report.id);

    const response = await request('PATCH', `/api/receipts/${receipt.id}`, {
      amount_cents: 37.6,
    });

    expect(response.status).toBe(422);
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'amount_cents' }),
    );
  });

  it('rejeita data inexistente no calendario', async () => {
    const report = await insertReport();
    const receipt = await insertReceipt(report.id);

    const response = await request('PATCH', `/api/receipts/${receipt.id}`, {
      issued_at: '2026-02-31',
    });

    expect(response.status).toBe(422);
  });

  it('rejeita corpo sem campos atualizaveis', async () => {
    const report = await insertReport();
    const receipt = await insertReceipt(report.id);

    const response = await request('PATCH', `/api/receipts/${receipt.id}`, {
      file_hash: 'tentando trocar a identidade da pagina',
    });

    expect(response.status).toBe(422);
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'body' }),
    );
  });

  it('atualiza o updated_at pelo trigger', async () => {
    const report = await insertReport();
    const receipt = await insertReceipt(report.id);

    const response = await request('PATCH', `/api/receipts/${receipt.id}`, {
      category: 'outros',
    });

    expect(response.body.data.updated_at).not.toEqual(receipt.updated_at);
  });

  it('retorna 404 para id inexistente', async () => {
    const response = await request('PATCH', '/api/receipts/999999', {
      category: 'outros',
    });

    expect(response.status).toBe(404);
  });
});
