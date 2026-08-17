'use strict';

const {
  request,
  requestUpload,
  insertReport,
  insertReceipt,
  findReceipts,
  uploadedFileExists,
  waitForProcessing,
} = require('../../orchestrator');
const { makePdf } = require('../../fixtures/pdf');

describe('DELETE /api/receipts/:id', () => {
  it('remove o comprovante e retorna 204', async () => {
    const report = await insertReport();
    const receipt = await insertReceipt(report.id);

    const deleted = await request('DELETE', `/api/receipts/${receipt.id}`);
    expect(deleted.status).toBe(204);

    const lookup = await request('GET', `/api/receipts/${receipt.id}`);
    expect(lookup.status).toBe(404);
  });

  it('tira o comprovante confirmado do somatorio do relatorio', async () => {
    const report = await insertReport();
    await insertReceipt(report.id, {
      status: 'confirmed',
      amount_cents: 1000,
      category: 'alimentacao',
      issued_at: '2026-06-10',
    });
    const descartado = await insertReceipt(report.id, {
      page_number: 2,
      status: 'confirmed',
      amount_cents: 2500,
      category: 'alimentacao',
      issued_at: '2026-06-11',
    });

    await request('DELETE', `/api/receipts/${descartado.id}`);

    const { body } = await request('GET', `/api/reports/${report.id}/receipts`);

    // A linha some do total, e nao so da listagem: o resumo da tela le daqui.
    expect(body.meta.total).toBe(1);
    expect(body.meta.total_cents).toBe(1000);
  });

  it('retorna 404 ao deletar id inexistente', async () => {
    const response = await request('DELETE', '/api/receipts/999999');

    expect(response.status).toBe(404);
  });

  it('apagar o relatorio leva os comprovantes junto', async () => {
    const report = await insertReport();
    const receipt = await insertReceipt(report.id);

    await request('DELETE', `/api/reports/${report.id}`);

    // FK com ON DELETE CASCADE: nao pode sobrar comprovante orfao.
    const lookup = await request('GET', `/api/receipts/${receipt.id}`);
    expect(lookup.status).toBe(404);
  });
});

describe('retencao do arquivo enviado', () => {
  async function uploadPdf(reportId, options) {
    await requestUpload(`/api/reports/${reportId}/receipts`, [
      { buffer: await makePdf(options), filename: 'cupons.pdf' },
    ]);
    // O upload responde 202: esperar a fila evita apagar o arquivo debaixo do
    // pipeline, que ainda esta lendo a pagina.
    await waitForProcessing(reportId);

    return findReceipts(reportId);
  }

  it('apagar a ultima pagina apaga o PDF do disco', async () => {
    const report = await insertReport();
    const [receipt] = await uploadPdf(report.id, { pages: 1 });

    expect(uploadedFileExists(receipt.file_hash)).toBe(true);

    await request('DELETE', `/api/receipts/${receipt.id}`);

    expect(uploadedFileExists(receipt.file_hash)).toBe(false);
  });

  it('apagar uma pagina preserva o PDF das outras', async () => {
    const report = await insertReport();
    const receipts = await uploadPdf(report.id, { pages: 3 });

    await request('DELETE', `/api/receipts/${receipts[0].id}`);

    // Um arquivo so atende as tres paginas: apagar junto com a primeira linha
    // levaria embora o cupom das outras duas.
    expect(uploadedFileExists(receipts[0].file_hash)).toBe(true);

    await request('DELETE', `/api/receipts/${receipts[1].id}`);
    await request('DELETE', `/api/receipts/${receipts[2].id}`);

    expect(uploadedFileExists(receipts[2].file_hash)).toBe(false);
  });

  it('apagar o relatorio apaga os PDFs que ele referenciava', async () => {
    const report = await insertReport();
    const [receipt] = await uploadPdf(report.id, { pages: 2 });

    await request('DELETE', `/api/reports/${report.id}`);

    expect(uploadedFileExists(receipt.file_hash)).toBe(false);
  });

  it('o mesmo PDF em outro relatorio sobrevive a exclusao do primeiro', async () => {
    const first = await insertReport();
    const second = await insertReport({ title: 'Outra viagem' });
    const buffer = await makePdf({ pages: 1, text: 'compartilhado' });
    const files = [{ buffer, filename: 'cupons.pdf' }];

    await requestUpload(`/api/reports/${first.id}/receipts`, files);
    await requestUpload(`/api/reports/${second.id}/receipts`, files);
    await waitForProcessing(first.id);
    await waitForProcessing(second.id);

    const [receipt] = await findReceipts(second.id);

    await request('DELETE', `/api/reports/${first.id}`);

    // O nome do arquivo e o SHA-256 do conteudo: os dois relatorios apontam
    // para o mesmo PDF, e o segundo ainda precisa dele.
    expect(uploadedFileExists(receipt.file_hash)).toBe(true);

    await request('DELETE', `/api/reports/${second.id}`);

    expect(uploadedFileExists(receipt.file_hash)).toBe(false);
  });
});
