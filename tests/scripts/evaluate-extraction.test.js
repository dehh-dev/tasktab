'use strict';

const {
  runScript,
  request,
  requestUpload,
  insertReport,
  insertReceipt,
  updateColumnDirectly,
  waitForProcessing,
} = require('../orchestrator');
const { makeReceiptPdf } = require('../fixtures/pdf');

function evaluate(...args) {
  return runScript('scripts/evaluate-extraction.js', args);
}

const CONFIRMADO = {
  issued_at: '2026-08-14',
  amount_cents: 4860,
  category: 'alimentacao',
  status: 'confirmed',
};

// Uma pagina por comprovante: o mesmo arquivo e pagina no mesmo relatorio e
// o mesmo comprovante.
let pagina = 0;

// Comprovante confirmado com o que a extracao tinha proposto para ele.
async function confirmado(reportId, proposta, overrides = {}) {
  pagina += 1;

  const receipt = await insertReceipt(reportId, {
    ...CONFIRMADO,
    page_number: pagina,
    ...overrides,
  });

  if (proposta !== null) {
    await updateColumnDirectly('receipts', receipt.id, 'extracted', proposta);
  }

  return receipt;
}

describe('npm run extraction:evaluate', () => {
  it('conta por campo o que a extracao acertou, errou e deixou vazio', async () => {
    const report = await insertReport();

    // Tudo certo, pelo QR e pela NFC-e.
    await confirmado(
      report.id,
      {
        parser: 'nfce',
        extraction_source: 'qr',
        confidence: 0.9,
        issued_at: '2026-08-14',
        amount_cents: 4860,
        access_key: '52260626048802000165650010001631601303284889',
        category: 'alimentacao',
        category_guessed: true,
      },
      { access_key: '52260626048802000165650010001631601303284889' },
    );
    // Valor errado com confianca alta: o erro que chega sem destaque. A
    // data, a pessoa preencheu. A categoria, corrigiu de um palpite.
    await confirmado(report.id, {
      parser: 'generic',
      extraction_source: 'ocr',
      confidence: 0.8,
      issued_at: null,
      amount_cents: 48600,
      access_key: null,
      category: 'combustivel',
      category_guessed: true,
    });
    // Recibo manuscrito: a extracao nao leu nada.
    await confirmado(report.id, { parser: null, extraction_source: null });
    // Confirmado antes de a proposta ser guardada: fica fora da medida.
    await confirmado(report.id, null);
    // Em revisao nao e medido: ninguem disse ainda qual e o valor certo.
    await insertReceipt(report.id, {
      ...CONFIRMADO,
      status: 'needs_review',
      page_number: 99,
    });

    const result = evaluate('--report', String(report.id), '--json');

    expect(result.status).toBe(0);

    const saida = JSON.parse(result.stdout);

    expect(saida).toMatchObject({ confirmed: 4, without_proposal: 1 });
    expect(saida.total).toEqual({
      issued_at: { right: 1, wrong: 0, empty: 2, wrong_unflagged: 0 },
      amount_cents: { right: 1, wrong: 1, empty: 1, wrong_unflagged: 1 },
      access_key: { right: 1, wrong: 0, empty: 0, wrong_unflagged: 0 },
      category: { right: 1, wrong: 1, empty: 1, wrong_unflagged: 0 },
    });
    expect(Object.keys(saida.by_source).sort()).toEqual([
      'nada_lido',
      'ocr',
      'qr',
    ]);
    expect(saida.by_parser.generic.amount_cents).toEqual({
      right: 0,
      wrong: 1,
      empty: 0,
      wrong_unflagged: 1,
    });
  });

  it('mede so o relatorio pedido', async () => {
    const outro = await insertReport();
    const pedido = await insertReport();

    await confirmado(outro.id, { parser: null, extraction_source: null });
    await confirmado(pedido.id, null);

    const saida = JSON.parse(
      evaluate('--report', String(pedido.id), '--json').stdout,
    );

    expect(saida).toMatchObject({ confirmed: 1, without_proposal: 1 });
  });

  it('imprime so contagens, nunca o que o comprovante traz', async () => {
    const report = await insertReport();
    const chave = '52260626048802000165650010001631601303284889';

    await confirmado(
      report.id,
      {
        parser: 'nfce',
        extraction_source: 'ocr',
        confidence: 0.5,
        issued_at: '2026-08-14',
        amount_cents: 4860,
        access_key: chave,
        cnpj: '26048802000165',
        issuer_name: 'MERCEARIA FRANGUINHO',
      },
      { access_key: chave },
    );

    const result = evaluate('--report', String(report.id));

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Comprovantes confirmados: 1/);
    expect(result.stdout).toMatch(/valor\s+1\s+0\s+0\s+0/);
    for (const dado of [chave, '26048802000165', 'FRANGUINHO', '48,60']) {
      expect(result.stdout).not.toContain(dado);
    }
  });

  describe('--reextract', () => {
    // Um comprovante como os de antes da coluna: enviado e confirmado com o
    // valor corrigido, sem a proposta guardada.
    async function confirmadoSemProposta() {
      const report = await insertReport();

      await requestUpload(`/api/reports/${report.id}/receipts`, [
        {
          buffer: await makeReceiptPdf({ total: '37,60', date: '19/06/2026' }),
          filename: 'a.pdf',
        },
      ]);
      await waitForProcessing(report.id);

      const lista = await request('GET', `/api/reports/${report.id}/receipts`);
      const [receipt] = lista.body.data;

      await request('PATCH', `/api/receipts/${receipt.id}`, {
        issued_at: '2026-06-19',
        amount_cents: 3670,
        category: 'alimentacao',
        status: 'confirmed',
      });
      await updateColumnDirectly('receipts', receipt.id, 'extracted', null);

      return { report, receipt };
    }

    it('le o PDF de novo e mede o codigo de hoje contra o confirmado', async () => {
      const { report } = await confirmadoSemProposta();

      const result = evaluate(
        '--report',
        String(report.id),
        '--reextract',
        '--json',
      );

      expect(result.status).toBe(0);

      const saida = JSON.parse(result.stdout);

      expect(saida).toMatchObject({
        mode: 'reextract',
        confirmed: 1,
        without_proposal: 0,
      });
      expect(saida.total.issued_at).toMatchObject({ right: 1, wrong: 0 });
      expect(saida.total.amount_cents).toMatchObject({ right: 0, wrong: 1 });
      expect(Object.keys(saida.by_parser)).toEqual(['nfce']);
    });

    it('nao grava nada: nem o comprovante, nem emitente novo', async () => {
      const { report, receipt } = await confirmadoSemProposta();

      // O emitente do cupom passa a ser desconhecido: a extracao de verdade o
      // cadastraria, a reextracao nao pode.
      await updateColumnDirectly(
        'merchants',
        receipt.merchant_id,
        'cnpj',
        '11222333000181',
      );

      const antes = await request('GET', `/api/receipts/${receipt.id}`);
      const emitentesAntes = await request('GET', '/api/merchants');

      const result = evaluate(
        '--report',
        String(report.id),
        '--reextract',
        '--json',
      );

      const depois = await request('GET', `/api/receipts/${receipt.id}`);
      const emitentesDepois = await request('GET', '/api/merchants');

      expect(result.status).toBe(0);
      expect(depois.body.data).toEqual(antes.body.data);
      expect(depois.body.data.extracted).toBeNull();
      expect(emitentesDepois.body.meta.total).toBe(
        emitentesAntes.body.meta.total,
      );
    });

    it('conta a parte o comprovante cujo arquivo saiu do disco', async () => {
      const report = await insertReport();

      await insertReceipt(report.id, {
        ...CONFIRMADO,
        file_path: 'nao-existe.pdf',
      });

      const saida = JSON.parse(
        evaluate('--report', String(report.id), '--reextract', '--json').stdout,
      );

      expect(saida).toMatchObject({ confirmed: 1, without_proposal: 1 });
    });
  });

  it('recusa relatorio que nao e id', () => {
    const result = evaluate('--report', 'noventa');

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--report deve ser um id numerico/);
  });
});
