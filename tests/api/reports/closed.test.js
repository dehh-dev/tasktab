'use strict';

const {
  request,
  requestUpload,
  insertReport,
  insertReceipt,
  createUserWithSession,
  leftoverUploads,
} = require('../../orchestrator');
const { makeReceiptPdf } = require('../../fixtures/pdf');

/**
 * Relatorio fechado e somente leitura, ate para o dono: e o que foi assinado.
 * O unico PATCH aceito e o que o reabre.
 */
async function closedReportWithReceipt() {
  const report = await insertReport({ status: 'closed' });
  const receipt = await insertReceipt(report.id, {
    status: 'needs_review',
    category: 'alimentacao',
  });
  return { report, receipt };
}

function summary(response) {
  return `${response.status} ${response.body?.name ?? ''}`.trim();
}

describe('relatorio fechado', () => {
  it('recusa toda escrita com 409, inclusive o upload', async () => {
    const { report, receipt } = await closedReportWithReceipt();

    const responses = {
      upload: await requestUpload(`/api/reports/${report.id}/receipts`, [
        { buffer: await makeReceiptPdf(), filename: 'a.pdf' },
      ]),
      editReport: await request('PATCH', `/api/reports/${report.id}`, {
        title: 'Outro titulo',
      }),
      deleteReport: await request('DELETE', `/api/reports/${report.id}`),
      editReceipt: await request('PATCH', `/api/receipts/${receipt.id}`, {
        amount_cents: 100,
      }),
      deleteReceipt: await request('DELETE', `/api/receipts/${receipt.id}`),
      reprocess: await request('POST', `/api/receipts/${receipt.id}/reprocess`),
    };

    expect(
      Object.fromEntries(
        Object.entries(responses).map(([key, value]) => [key, summary(value)]),
      ),
    ).toEqual({
      upload: '409 ConflictError',
      editReport: '409 ConflictError',
      deleteReport: '409 ConflictError',
      editReceipt: '409 ConflictError',
      deleteReceipt: '409 ConflictError',
      reprocess: '409 ConflictError',
    });
    // O multer grava antes de o relatorio ser conferido; recusado, o arquivo
    // nao pode ficar no disco.
    expect(leftoverUploads()).toEqual([]);
  });

  it('o erro diz como sair dali', async () => {
    const { receipt } = await closedReportWithReceipt();

    const response = await request('PATCH', `/api/receipts/${receipt.id}`, {
      amount_cents: 100,
    });

    expect(response.body.action).toMatch(/Reabra o relatorio/);
  });

  it('continua legivel e exportavel', async () => {
    const { report, receipt } = await closedReportWithReceipt();

    const statuses = {
      report: (await request('GET', `/api/reports/${report.id}`)).status,
      receipts: (await request('GET', `/api/reports/${report.id}/receipts`))
        .status,
      receipt: (await request('GET', `/api/receipts/${receipt.id}`)).status,
      validation: (await request('GET', `/api/reports/${report.id}/validation`))
        .status,
    };

    expect(statuses).toEqual({
      report: 200,
      receipts: 200,
      receipt: 200,
      validation: 200,
    });
  });

  it('reabre com PATCH status open, e a escrita volta a valer', async () => {
    const { report, receipt } = await closedReportWithReceipt();

    const reopened = await request('PATCH', `/api/reports/${report.id}`, {
      status: 'open',
    });
    const edited = await request('PATCH', `/api/receipts/${receipt.id}`, {
      amount_cents: 100,
    });

    expect(reopened.status).toBe(200);
    expect(reopened.body.data.status).toBe('open');
    expect(edited.status).toBe(200);
  });

  it('reabrir junto com outra mudanca e recusado: primeiro reabre', async () => {
    const { report } = await closedReportWithReceipt();

    const response = await request('PATCH', `/api/reports/${report.id}`, {
      status: 'open',
      title: 'Outro titulo',
    });

    expect(response.status).toBe(409);
  });

  it('a posse vem antes do fechamento: relatorio alheio fechado continua 404', async () => {
    // Um 409 aqui confirmaria que o relatorio existe para quem nao o alcanca.
    const { receipt } = await closedReportWithReceipt();
    const outsider = await createUserWithSession({ role: 'user' });

    const response = await request(
      'PATCH',
      `/api/receipts/${receipt.id}`,
      { amount_cents: 100 },
      { token: outsider.token },
    );

    expect(response.status).toBe(404);
  });
});
