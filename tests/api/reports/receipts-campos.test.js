'use strict';

const {
  request,
  requestUpload,
  insertReport,
  waitForProcessing,
} = require('../../orchestrator');
const { makeReceiptPdf } = require('../../fixtures/pdf');

async function uploadAndRead(reportId, options) {
  await requestUpload(`/api/reports/${reportId}/receipts`, [
    { buffer: await makeReceiptPdf(options), filename: 'cupom.pdf' },
  ]);
  await waitForProcessing(reportId);

  const response = await request('GET', `/api/reports/${reportId}/receipts`);
  return response.body.data[0];
}

describe('cidade do emitente na extracao', () => {
  it('cadastra o emitente com a cidade lida do endereco', async () => {
    const report = await insertReport();
    await uploadAndRead(report.id);

    const merchants = await request('GET', '/api/merchants');

    expect(merchants.body.data[0]).toMatchObject({
      city: 'Abadiania/GO',
      // O nome vem da razao social, nao da primeira linha da pagina.
      name: 'MERCEARIA FRANGUINHO NA PANELA LTDA',
    });
  });
});

describe('marca de categoria adivinhada', () => {
  it('some quando uma pessoa escolhe a categoria', async () => {
    const report = await insertReport();
    const receipt = await uploadAndRead(report.id);

    expect(receipt.category_guessed).toBe(true);

    const response = await request('PATCH', `/api/receipts/${receipt.id}`, {
      category: 'outros',
    });

    // A partir daqui a decisao e de quem assina, e continuar avisando "isto e
    // um palpite" seria mentira.
    expect(response.body.data.category).toBe('outros');
    expect(response.body.data.category_guessed).toBe(false);
  });

  it('some ao confirmar, mesmo sem mexer na categoria', async () => {
    const report = await insertReport();
    const receipt = await uploadAndRead(report.id);

    const response = await request('PATCH', `/api/receipts/${receipt.id}`, {
      status: 'confirmed',
    });

    // Confirmar e assinar embaixo do palpite: ele deixou de ser palpite.
    expect(response.status).toBe(200);
    expect(response.body.data.category_guessed).toBe(false);
  });
});
