'use strict';

const {
  requestUpload,
  request,
  insertReport,
  waitForProcessing,
} = require('../../orchestrator');
const {
  makePdf,
  makeReceiptPdf,
  makeQrReceiptPdf,
  makeCorruptPdf,
} = require('../../fixtures/pdf');

async function upload(reportId, files) {
  return requestUpload(`/api/reports/${reportId}/receipts`, files);
}

async function listReceipts(reportId) {
  // O upload responde 202: o conteudo so existe depois que a fila roda.
  await waitForProcessing(reportId);
  const response = await request('GET', `/api/reports/${reportId}/receipts`);
  return response.body.data;
}

describe('extracao no upload', () => {
  it('guarda o texto da pagina para auditoria', async () => {
    const report = await insertReport();

    await upload(report.id, [
      { buffer: await makeReceiptPdf({ total: '37,60' }), filename: 'a.pdf' },
    ]);

    const [receipt] = await listReceipts(report.id);

    expect(receipt.raw_text).toContain('VALOR TOTAL R$ 37,60');
    expect(receipt.raw_text).toContain('26.048.802/0001-65');
    expect(receipt.extraction_source).toBe('text');
    expect(receipt.status).toBe('needs_review');
  });

  it('guarda o texto de cada pagina separadamente', async () => {
    const report = await insertReport();

    await upload(report.id, [
      {
        buffer: await makeReceiptPdf({ pages: 2, total: '48,60' }),
        filename: 'duas.pdf',
      },
    ]);

    const receipts = await listReceipts(report.id);

    expect(receipts).toHaveLength(2);
    expect(receipts.map((receipt) => receipt.page_number)).toEqual([1, 2]);
    expect(
      receipts.every((receipt) => receipt.raw_text.includes('48,60')),
    ).toBe(true);
  });

  it('desce para o OCR quando nao ha camada de texto util', async () => {
    const report = await insertReport();

    await upload(report.id, [
      { buffer: await makePdf({ text: '2' }), filename: 'escaneado.pdf' },
    ]);

    const [receipt] = await listReceipts(report.id);

    // Ate o M3 a pagina parava aqui com extraction_source nulo. Com o OCR no
    // fim da cascata, ela passa a ser lida como imagem.
    expect(receipt.extraction_source).toBe('ocr');
    expect(receipt.status).toBe('needs_review');
  });

  it('nao tenta extrair de um PDF que nem abriu', async () => {
    const report = await insertReport();

    await upload(report.id, [
      { buffer: makeCorruptPdf(), filename: 'corrompido.pdf' },
    ]);

    const [receipt] = await listReceipts(report.id);

    expect(receipt.status).toBe('failed');
    expect(receipt.raw_text).toMatch(/Falha ao ler o PDF/);
  });

  it('preenche data e valor sozinho, a partir do texto', async () => {
    const report = await insertReport();

    await upload(report.id, [
      {
        buffer: await makeReceiptPdf({ total: '37,60', date: '19/06/2026' }),
        filename: 'cupom.pdf',
      },
    ]);

    const [receipt] = await listReceipts(report.id);

    // O ganho do M2: a pessoa deixa de digitar e passa a conferir.
    expect(receipt.issued_at).toBe('2026-06-19');
    expect(receipt.amount_cents).toBe(3760);
    expect(Number(receipt.confidence)).toBeGreaterThan(0);
  });

  it('nao confirma nada sozinho, mesmo tendo lido tudo', async () => {
    const report = await insertReport();

    await upload(report.id, [
      { buffer: await makeReceiptPdf(), filename: 'cupom.pdf' },
    ]);

    const [receipt] = await listReceipts(report.id);

    // Extrair nao e conferir. Confirmar continua sendo ato humano.
    expect(receipt.status).toBe('needs_review');
    expect(receipt.category).toBeNull();
  });

  it('nao soma no total o que ainda nao foi confirmado', async () => {
    const report = await insertReport();

    await upload(report.id, [
      { buffer: await makeReceiptPdf({ total: '37,60' }), filename: 'a.pdf' },
    ]);

    await waitForProcessing(report.id);
    const response = await request('GET', `/api/reports/${report.id}/receipts`);

    // O valor ja esta na linha, mas o emitente ainda nao foi classificado,
    // entao nao ha subtotal por categoria.
    expect(response.body.data[0].amount_cents).toBe(3760);
    expect(response.body.meta.by_category).toEqual({});
  });

  it('extrai cada arquivo do lote independentemente', async () => {
    const report = await insertReport();

    await upload(report.id, [
      { buffer: await makeReceiptPdf({ pages: 2 }), filename: 'digital.pdf' },
      { buffer: await makePdf({ text: '2' }), filename: 'escaneado.pdf' },
    ]);

    const sources = (await listReceipts(report.id))
      .map((receipt) => receipt.extraction_source)
      .sort();

    expect(sources).toEqual(['ocr', 'text', 'text']);
  });
});

describe('chave de acesso', () => {
  const CHAVE = '52260626048802000165650010001631601303284889';

  it('le a chave do QR Code do cupom', async () => {
    const report = await insertReport();

    await upload(report.id, [
      {
        buffer: await makeQrReceiptPdf({ accessKey: CHAVE, total: '37,60' }),
        filename: 'nfce.pdf',
      },
    ]);

    const [receipt] = await listReceipts(report.id);

    expect(receipt.access_key).toBe(CHAVE);
    // O QR tem correcao de erro propria: vale mais que o texto impresso.
    expect(receipt.extraction_source).toBe('qr');
  });

  it('cai para a chave impressa quando nao ha QR legivel', async () => {
    const report = await insertReport();

    await upload(report.id, [
      {
        buffer: await makeReceiptPdf({ extra: [`Chave de acesso ${CHAVE}`] }),
        filename: 'sem-qr.pdf',
      },
    ]);

    const [receipt] = await listReceipts(report.id);

    expect(receipt.access_key).toBe(CHAVE);
    expect(receipt.extraction_source).toBe('text');
  });

  it('descarta chave impressa que nao fecha o digito verificador', async () => {
    const report = await insertReport();
    const quebrada = `${CHAVE.slice(0, 43)}${(Number(CHAVE[43]) + 1) % 10}`;

    await upload(report.id, [
      {
        buffer: await makeReceiptPdf({
          extra: [`Chave de acesso ${quebrada}`],
        }),
        filename: 'chave-ruim.pdf',
      },
    ]);

    const [receipt] = await listReceipts(report.id);

    // Aceitar uma chave que a propria norma diz estar errada seria pior que
    // nao ter chave: o vinculo com o emitente sairia errado.
    expect(receipt.access_key).toBeNull();
    expect(receipt.status).toBe('needs_review');
  });

  it('nao contamina a pagina seguinte com a chave da anterior', async () => {
    const report = await insertReport();

    await upload(report.id, [
      {
        buffer: await makeQrReceiptPdf({ accessKey: CHAVE }),
        filename: 'a.pdf',
      },
      { buffer: await makeReceiptPdf(), filename: 'b.pdf' },
    ]);

    const chaves = (await listReceipts(report.id)).map(
      (receipt) => receipt.access_key,
    );

    // Sem ordenar: `sort()` compara como texto e poria null depois da chave.
    expect(chaves).toHaveLength(2);
    expect(chaves).toEqual(expect.arrayContaining([null, CHAVE]));
  });
});
