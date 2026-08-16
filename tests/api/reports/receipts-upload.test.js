'use strict';

const {
  requestUpload,
  insertReport,
  findReceipts,
} = require('../../orchestrator');
const { makePdf, makeCorruptPdf, makeNonPdf } = require('../../fixtures/pdf');

describe('POST /api/reports/:id/receipts', () => {
  it('cria uma linha por pagina do PDF', async () => {
    const report = await insertReport();
    const buffer = await makePdf({ pages: 3 });

    const response = await requestUpload(`/api/reports/${report.id}/receipts`, [
      { buffer, filename: 'cupons.pdf' },
    ]);

    expect(response.status).toBe(201);
    expect(response.body.data).toHaveLength(3);
    expect(response.body.meta).toEqual({ created: 3, existing: 0 });

    const receipts = await findReceipts(report.id);

    expect(receipts.map((receipt) => receipt.page_number)).toEqual([1, 2, 3]);
    expect(receipts.every((receipt) => receipt.status === 'pending')).toBe(
      true,
    );
  });

  it('aceita varios arquivos de uma vez', async () => {
    const report = await insertReport();

    const response = await requestUpload(`/api/reports/${report.id}/receipts`, [
      {
        buffer: await makePdf({ pages: 2, text: 'primeiro' }),
        filename: 'a.pdf',
      },
      {
        buffer: await makePdf({ pages: 1, text: 'segundo' }),
        filename: 'b.pdf',
      },
    ]);

    expect(response.status).toBe(201);
    expect(response.body.data).toHaveLength(3);
  });

  it('reenviar o mesmo arquivo nao duplica e nao da erro', async () => {
    const report = await insertReport();
    const buffer = await makePdf({ pages: 2 });
    const files = [{ buffer, filename: 'cupons.pdf' }];

    const first = await requestUpload(
      `/api/reports/${report.id}/receipts`,
      files,
    );
    expect(first.status).toBe(201);

    const second = await requestUpload(
      `/api/reports/${report.id}/receipts`,
      files,
    );

    // Reenvio e operacao valida e idempotente, nao erro de unique.
    expect(second.status).toBe(200);
    expect(second.body.data).toHaveLength(0);
    expect(second.body.meta).toEqual({ created: 0, existing: 2 });
    expect(await findReceipts(report.id)).toHaveLength(2);
  });

  it('o mesmo arquivo em relatorios diferentes entra nos dois', async () => {
    const [um, outro] = [await insertReport(), await insertReport()];
    const buffer = await makePdf({ pages: 1 });
    const files = [{ buffer, filename: 'cupom.pdf' }];

    await requestUpload(`/api/reports/${um.id}/receipts`, files);
    const response = await requestUpload(
      `/api/reports/${outro.id}/receipts`,
      files,
    );

    expect(response.status).toBe(201);
    expect(await findReceipts(outro.id)).toHaveLength(1);
  });

  it('rejeita arquivo que nao e PDF, olhando os magic bytes', async () => {
    const report = await insertReport();

    const response = await requestUpload(
      `/api/reports/${report.id}/receipts`,
      // Nome e extensao de PDF, conteudo que nao e.
      [{ buffer: makeNonPdf(), filename: 'disfarcado.pdf' }],
    );

    expect(response.status).toBe(422);
    expect(response.body.name).toBe('ValidationError');
    expect(await findReceipts(report.id)).toHaveLength(0);
  });

  it('recusa o lote inteiro se um dos arquivos nao for PDF', async () => {
    const report = await insertReport();

    const response = await requestUpload(`/api/reports/${report.id}/receipts`, [
      { buffer: await makePdf({ pages: 1 }), filename: 'bom.pdf' },
      { buffer: makeNonPdf(), filename: 'ruim.pdf' },
    ]);

    // Aceitar metade do lote deixaria o usuario sem saber o que entrou.
    expect(response.status).toBe(422);
    expect(await findReceipts(report.id)).toHaveLength(0);
  });

  it('PDF ilegivel vira uma linha em failed, com o motivo', async () => {
    const report = await insertReport();

    const response = await requestUpload(`/api/reports/${report.id}/receipts`, [
      { buffer: makeCorruptPdf(), filename: 'corrompido.pdf' },
    ]);

    expect(response.status).toBe(201);

    const receipts = await findReceipts(report.id);

    expect(receipts).toHaveLength(1);
    expect(receipts[0].status).toBe('failed');
    expect(receipts[0].raw_text).toMatch(/Falha ao ler o PDF/);
  });

  it('um arquivo ruim nao impede os bons de entrarem', async () => {
    const report = await insertReport();

    await requestUpload(`/api/reports/${report.id}/receipts`, [
      { buffer: makeCorruptPdf(), filename: 'corrompido.pdf' },
      { buffer: await makePdf({ pages: 2 }), filename: 'bom.pdf' },
    ]);

    const receipts = await findReceipts(report.id);
    const status = receipts.map((receipt) => receipt.status).sort();

    expect(receipts).toHaveLength(3);
    expect(status).toEqual(['failed', 'pending', 'pending']);
  });

  it('retorna 404 para relatorio inexistente', async () => {
    const response = await requestUpload('/api/reports/999999/receipts', [
      { buffer: await makePdf({ pages: 1 }), filename: 'cupom.pdf' },
    ]);

    expect(response.status).toBe(404);
    expect(response.body.name).toBe('NotFoundError');
  });

  it('retorna 422 quando nenhum arquivo e enviado', async () => {
    const report = await insertReport();

    const response = await requestUpload(
      `/api/reports/${report.id}/receipts`,
      [],
    );

    expect(response.status).toBe(422);
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'files' }),
    );
  });
});
