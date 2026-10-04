'use strict';

const {
  requestUpload,
  insertReport,
  findReceipts,
  waitForProcessing,
  leftoverUploads,
  startApiInstance,
} = require('../../orchestrator');
const { makePdf, makeCorruptPdf, makeNonPdf } = require('../../fixtures/pdf');

describe('POST /api/reports/:id/receipts', () => {
  it('cria uma linha por pagina do PDF', async () => {
    const report = await insertReport();
    const buffer = await makePdf({ pages: 3 });

    const response = await requestUpload(`/api/reports/${report.id}/receipts`, [
      { buffer, filename: 'cupons.pdf' },
    ]);

    expect(response.status).toBe(202);
    expect(response.body.data).toHaveLength(3);
    expect(response.body.meta).toEqual({ created: 3, existing: 0 });

    // As linhas ja existem; o conteudo delas ainda esta sendo lido.
    expect(await findReceipts(report.id)).toHaveLength(3);

    await waitForProcessing(report.id);
    const receipts = await findReceipts(report.id);

    expect(receipts.map((receipt) => receipt.page_number)).toEqual([1, 2, 3]);
    expect(receipts.every((receipt) => receipt.status === 'needs_review')).toBe(
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

    expect(response.status).toBe(202);
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
    expect(first.status).toBe(202);

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

    expect(response.status).toBe(202);
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

  it('PDF ilegivel vira linha em failed, com o motivo, sem barrar os bons', async () => {
    const report = await insertReport();

    const response = await requestUpload(`/api/reports/${report.id}/receipts`, [
      { buffer: makeCorruptPdf(), filename: 'corrompido.pdf' },
      { buffer: await makePdf({ pages: 2 }), filename: 'bom.pdf' },
    ]);

    expect(response.status).toBe(202);

    await waitForProcessing(report.id);

    const receipts = await findReceipts(report.id);
    const status = receipts.map((receipt) => receipt.status).sort();
    const failed = receipts.find((receipt) => receipt.status === 'failed');

    expect(receipts).toHaveLength(3);
    expect(status).toEqual(['failed', 'needs_review', 'needs_review']);
    // O motivo fica na linha: a pessoa sabe o que refazer sem abrir o log.
    expect(failed.raw_text).toMatch(/Falha ao ler o PDF/);
  });

  it('recusa relatorio inexistente e apaga do disco o que o multer ja gravou', async () => {
    // O 404 de toda rota com id mora em `contract.test.js`. Este fica porque
    // e o unico que manda arquivo de verdade: o multer grava antes de o
    // controller saber que o relatorio nao existe, e o que sobrasse seria um
    // PDF com CNPJ de terceiros que ninguem mais alcanca pela API.
    const before = leftoverUploads();

    const response = await requestUpload('/api/reports/999999/receipts', [
      { buffer: await makePdf({ pages: 1 }), filename: 'cupom.pdf' },
    ]);

    expect(response.status).toBe(404);
    expect(response.body.name).toBe('NotFoundError');
    expect(leftoverUploads()).toEqual(before);
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

/**
 * Os limites do upload, numa instancia com tetos baixos: com os de verdade
 * (20 MB, 20 arquivos), provar o estouro custaria mandar 20 MB. Nenhum caso
 * chega a processar pagina, entao uma instancia serve o arquivo inteiro.
 */
describe('POST /api/reports/:id/receipts com os limites do upload', () => {
  let instance = null;

  beforeAll(async () => {
    instance = await startApiInstance({
      UPLOAD_MAX_BYTES: '2000',
      UPLOAD_MAX_FILES: '2',
    });
  }, 70000);

  afterAll(async () => {
    await instance?.stop();
  });

  async function enviar(files, options = {}) {
    const report = await insertReport();
    const response = await requestUpload(
      `/api/reports/${report.id}/receipts`,
      files,
      { baseUrl: instance.baseUrl, ...options },
    );

    return { response, receipts: await findReceipts(report.id) };
  }

  it('arquivo acima do limite e 422 no campo, e nada fica no disco', async () => {
    const before = leftoverUploads();

    const { response, receipts } = await enviar([
      { buffer: await makePdf({ pages: 20 }), filename: 'grande.pdf' },
    ]);

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      { field: 'files', message: 'LIMIT_FILE_SIZE' },
    ]);
    expect(receipts).toEqual([]);
    expect(leftoverUploads()).toEqual(before);
  });

  it('mais arquivos que o limite e 422 dizendo quantos cabem', async () => {
    const before = leftoverUploads();

    const { response, receipts } = await enviar(
      [1, 2, 3].map((page) => ({
        buffer: Buffer.from(`%PDF-1.7\n% arquivo ${page}\n%%EOF`),
        filename: `cupom-${page}.pdf`,
      })),
    );

    expect(response.status).toBe(422);
    expect(response.body.message).toBe('Envie no maximo 2 arquivos por vez.');
    expect(receipts).toEqual([]);
    expect(leftoverUploads()).toEqual(before);
  });

  it('arquivo fora do campo files e 422 dizendo o campo', async () => {
    const { response, receipts } = await enviar(
      [{ buffer: await makePdf(), filename: 'cupom.pdf' }],
      { field: 'arquivo' },
    );

    expect(response.status).toBe(422);
    expect(response.body.message).toBe('Envie os arquivos no campo "files".');
    expect(receipts).toEqual([]);
  });
});
