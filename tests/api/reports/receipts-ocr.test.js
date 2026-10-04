'use strict';

const {
  requestUpload,
  request,
  insertReport,
  waitForProcessing,
  updateColumnDirectly,
  startApiInstance,
} = require('../../orchestrator');
const {
  makePdf,
  makeScannedReceiptPdf,
  makeReceiptPdf,
} = require('../../fixtures/pdf');

async function upload(reportId, files) {
  return requestUpload(`/api/reports/${reportId}/receipts`, files);
}

async function listReceipts(reportId) {
  await waitForProcessing(reportId);
  const response = await request('GET', `/api/reports/${reportId}/receipts`);
  return response.body.data;
}

/**
 * A cascata inteira num upload so: um cupom digital e um escaneado.
 *
 * Eram sete testes, espalhados por dois arquivos, cada um subindo o proprio
 * PDF — e o Tesseract rodando cinco vezes, a parte mais cara da suite. Cada
 * afirmacao abaixo e uma daquelas; o que mudou e que pagam um OCR so.
 */
describe('cascata de extracao', () => {
  it('le o digital pelo texto e o escaneado pelo OCR, e nao confirma nenhum dos dois', async () => {
    const report = await insertReport();

    await upload(report.id, [
      {
        buffer: await makeReceiptPdf({ total: '48,60', date: '20/06/2026' }),
        filename: 'digital.pdf',
      },
      {
        // Escaneado costuma trazer um resto de camada de texto, como o numero
        // da pagina. Nao e texto util, e nao pode segurar a pagina fora do OCR.
        buffer: await makeScannedReceiptPdf({
          total: '37,60',
          date: '19/06/2026',
          residualText: '2',
        }),
        filename: 'escaneado.pdf',
      },
    ]);

    const receipts = await listReceipts(report.id);
    const digital = receipts.find((r) => r.extraction_source === 'text');
    const scanned = receipts.find((r) => r.extraction_source === 'ocr');

    // Cada pagina no degrau certo: o OCR e o mais caro, e so desce ate ele
    // quem nao tem camada de texto util.
    expect(receipts.map((r) => r.extraction_source).sort()).toEqual([
      'ocr',
      'text',
    ]);

    // Os dois lidos sozinhos — o ganho e a pessoa deixar de digitar e passar a
    // conferir.
    expect(digital).toMatchObject({
      issued_at: '2026-06-20',
      amount_cents: 4860,
    });
    expect(scanned).toMatchObject({
      issued_at: '2026-06-19',
      amount_cents: 3760,
    });
    expect(scanned.raw_text).toMatch(/FRANGUINHO/i);

    // E nenhum confirmado. Extrair nao e conferir — inclusive quando a
    // extracao preencheu tudo, categoria adivinhada incluida —, e o que veio
    // de OCR menos ainda.
    expect(receipts.map((r) => r.status)).toEqual([
      'needs_review',
      'needs_review',
    ]);

    // A confianca guia o destaque na revisao: o que veio de imagem merece
    // mais atencao que o que veio da camada de texto.
    expect(Number(digital.confidence)).toBeGreaterThan(0);
    expect(Number(scanned.confidence)).toBeLessThanOrEqual(
      Number(digital.confidence),
    );
  });
});

describe('processamento assincrono', () => {
  it('responde 202 e cria as linhas antes de processar', async () => {
    const report = await insertReport();

    const response = await upload(report.id, [
      { buffer: await makeReceiptPdf({ pages: 2 }), filename: 'a.pdf' },
    ]);

    // 202: os registros existem, o conteudo ainda esta sendo lido.
    expect(response.status).toBe(202);
    expect(response.body.data).toHaveLength(2);
    expect(
      response.body.data.every((receipt) => receipt.status === 'pending'),
    ).toBe(true);
  });

  it('o status progride ate needs_review', async () => {
    const report = await insertReport();

    await upload(report.id, [
      { buffer: await makeReceiptPdf(), filename: 'a.pdf' },
    ]);

    const [receipt] = await listReceipts(report.id);

    expect(receipt.status).toBe('needs_review');
  });

  it('reprocessar le a pagina girada na revisao', async () => {
    const report = await insertReport();

    // O cupom fotografado de cabeca para baixo: o Tesseract nao endireita a
    // pagina sozinho. E o unico escaneado a mais da suite, porque prova um
    // pedaco que o teste da cascata nao prova — o giro chegar ao OCR.
    await upload(report.id, [
      {
        buffer: await makeScannedReceiptPdf({
          total: '37,60',
          date: '19/06/2026',
          upsideDown: true,
        }),
        filename: 'invertido.pdf',
      },
    ]);
    const [receipt] = await listReceipts(report.id);

    await request('PATCH', `/api/receipts/${receipt.id}`, { rotation: 180 });
    const response = await request(
      'POST',
      `/api/receipts/${receipt.id}/reprocess`,
    );
    expect(response.status).toBe(202);

    const [reprocessado] = await listReceipts(report.id);
    expect(reprocessado).toMatchObject({
      extraction_source: 'ocr',
      issued_at: '2026-06-19',
      amount_cents: 3760,
    });
  }, 60000);

  it('reprocessa um comprovante pela rota', async () => {
    const report = await insertReport();

    await upload(report.id, [
      { buffer: await makeReceiptPdf({ total: '48,60' }), filename: 'a.pdf' },
    ]);

    const [receipt] = await listReceipts(report.id);

    // Simula o que sobra de um reinicio no meio do lote: a fila vive na
    // memoria do processo, entao ha registros que ficam presos em processing.
    // Escrito direto no banco porque a API nao produz esse estado — e um
    // PATCH marcaria a linha como corrigida a mao, que reprocessar so aceita
    // com a confirmacao do descarte.
    await updateColumnDirectly('receipts', receipt.id, 'amount_cents', null);
    await updateColumnDirectly('receipts', receipt.id, 'status', 'processing');

    const response = await request(
      'POST',
      `/api/receipts/${receipt.id}/reprocess`,
    );

    expect(response.status).toBe(202);

    const [reprocessado] = await listReceipts(report.id);
    expect(reprocessado.amount_cents).toBe(4860);
  });
});

/**
 * O OCR que nao sobe — idioma inexistente, dados que nao carregaram — nao
 * pode levar a API junto. Sem `errorHandler`, o tesseract.js relancava o erro
 * fora de qualquer promise e o processo caia no meio do lote.
 *
 * Instancia propria, para o idioma quebrado nao valer para o resto da suite.
 * As paginas sao em branco: o worker falha ao subir, antes de ler qualquer
 * coisa, e o teste nao paga o Tesseract.
 */
describe('OCR que nao sobe', () => {
  let instance = null;

  afterEach(async () => {
    await instance?.stop();
    instance = null;
  });

  it('a pagina vai para a revisao sem leitura, e a API segue de pe', async () => {
    instance = await startApiInstance({ OCR_LANGUAGE: 'xyz' });
    const report = await insertReport();

    // Duas paginas: a segunda prova que a falha da subida nao deixa a fila
    // parada esperando um worker que nunca vem.
    const response = await requestUpload(
      `/api/reports/${report.id}/receipts`,
      [
        { buffer: await makePdf({ lines: [] }), filename: 'branca.pdf' },
        {
          buffer: await makePdf({ lines: [], size: [310, 400] }),
          filename: 'outra-branca.pdf',
        },
      ],
      { baseUrl: instance.baseUrl },
    );
    expect(response.status).toBe(202);

    const receipts = await listReceipts(report.id);
    const health = await fetch(`${instance.baseUrl}/api/health`);

    expect(receipts.map((r) => [r.status, r.extraction_source])).toEqual([
      ['needs_review', null],
      ['needs_review', null],
    ]);
    expect(health.status).toBe(200);
  }, 70000);
});
