'use strict';

const {
  request,
  requestUpload,
  insertReport,
  insertReceipt,
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

describe('hora, documento e cidade na extracao', () => {
  it('preenche hora e documento a partir do texto do cupom', async () => {
    const report = await insertReport();

    const receipt = await uploadAndRead(report.id, {
      extra: ['NFC-e no 000009309 Serie 006'],
    });

    // Os tres campos existem para a planilha nao obrigar a voltar ao papel:
    // eles estavam no texto extraido desde sempre e eram jogados fora.
    expect(receipt.issued_at).toBe('2026-06-19');
    expect(receipt.issued_time).toBe('12:34:56');
    expect(receipt.document_ref).toBe('NFC-e 9309 / série 006');
  });

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

  it('deixa os campos nulos quando o documento nao os traz', async () => {
    const report = await insertReport();
    const created = await insertReceipt(report.id, { status: 'needs_review' });

    const response = await request('GET', `/api/receipts/${created.id}`);

    // Recibo manuscrito nao tem hora nem numero fiscal. `null` e a resposta
    // certa: um valor inventado passaria por leitura na hora de assinar.
    expect(response.body.data.issued_time).toBeNull();
    expect(response.body.data.document_ref).toBeNull();
  });
});

describe('PATCH /api/receipts/:id com os campos novos', () => {
  it('aceita hora e documento corrigidos a mao', async () => {
    const report = await insertReport();
    const created = await insertReceipt(report.id, { status: 'needs_review' });

    const response = await request('PATCH', `/api/receipts/${created.id}`, {
      issued_time: '09:07',
      document_ref: 'NFC-e 202017 / série 003',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.issued_time).toBe('09:07:00');
    expect(response.body.data.document_ref).toBe('NFC-e 202017 / série 003');
  });

  it('recusa hora fora do formato, apontando o campo', async () => {
    const report = await insertReport();
    const created = await insertReceipt(report.id, { status: 'needs_review' });

    const response = await request('PATCH', `/api/receipts/${created.id}`, {
      issued_time: '25:99',
    });

    expect(response.status).toBe(422);
    expect(response.body.name).toBe('ValidationError');
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'issued_time' }),
    );
  });

  it('limpa a hora quando o campo vem nulo', async () => {
    const report = await insertReport();
    const created = await insertReceipt(report.id, {
      status: 'needs_review',
      issued_time: '12:00:00',
    });

    const response = await request('PATCH', `/api/receipts/${created.id}`, {
      issued_time: null,
    });

    expect(response.body.data.issued_time).toBeNull();
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
