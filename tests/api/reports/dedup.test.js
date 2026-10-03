'use strict';

const {
  request,
  insertReport,
  insertReceipt,
  requestUpload,
  waitForProcessing,
  findReceipts,
} = require('../../orchestrator');
const { makeQrReceiptPdf } = require('../../fixtures/pdf');

// Duas notas reais do mesmo restaurante, dias diferentes, mesmo valor.
const NOTA_163119 = '52260626048802000165650010001631191940931307';
const NOTA_163160 = '52260626048802000165650010001631601303284889';

async function listReceipts(reportId) {
  await waitForProcessing(reportId);
  const response = await request('GET', `/api/reports/${reportId}/receipts`);
  return response.body;
}

/**
 * O primeiro retrato do banco em que nada mais esta em processamento, lido
 * sem intervalo e conferido na mesma consulta. E o que a tela ve quando para
 * de consultar: uma pagina que parecesse pronta antes de a duplicata ser
 * decidida apareceria aqui. O `waitForProcessing`, que dorme 50 ms entre as
 * leituras, so pegava essa janela de vez em quando.
 */
async function firstSettledSnapshot(reportId, { timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const rows = await findReceipts(reportId);
    const settled = rows.every(
      (row) => row.status !== 'pending' && row.status !== 'processing',
    );

    if (settled) {
      return rows;
    }
  }

  throw new Error(`A extracao do relatorio ${reportId} nao terminou.`);
}

describe('duplicata exata', () => {
  it('colapsa sozinha quando a chave de acesso e a mesma', async () => {
    const report = await insertReport();

    // Mesmo documento chegando por dois arquivos diferentes — o caso do cupom
    // fotografado e tambem baixado do portal.
    await requestUpload(`/api/reports/${report.id}/receipts`, [
      {
        buffer: await makeQrReceiptPdf({ accessKey: NOTA_163160 }),
        filename: 'a.pdf',
      },
    ]);
    await requestUpload(`/api/reports/${report.id}/receipts`, [
      {
        buffer: await makeQrReceiptPdf({
          accessKey: NOTA_163160,
          extra: ['VIA DO CLIENTE'],
        }),
        filename: 'b.pdf',
      },
    ]);

    const rows = await firstSettledSnapshot(report.id);
    const duplicata = rows.find((receipt) => receipt.status === 'duplicate');
    const original = rows.find((receipt) => receipt.status !== 'duplicate');

    // A duplicata ja existe no primeiro instante em que a pagina parece
    // pronta. Antes de a decisao vir junto com o status, esta linha falhava
    // sempre que lida sem intervalo.
    expect(rows.map((receipt) => receipt.status).sort()).toEqual([
      'duplicate',
      'needs_review',
    ]);
    // Apontar para o original, e nao so ter o campo preenchido: `null` passaria
    // num `toBeDefined`.
    expect(duplicata.duplicate_of_id).toBe(original.id);
  });
});

describe('o contraexemplo obrigatorio', () => {
  it('NAO marca como duplicata dois almocos iguais em dias diferentes', async () => {
    const report = await insertReport({
      period_start: '2026-06-01',
      period_end: '2026-06-30',
    });

    // 17/06 e 23/06, ambos Franguinho, ambos R$ 48,60, notas 163119 e 163284.
    // Foi exatamente essa confusao que sumiu com R$ 48,60 da planilha oficial
    // que originou este projeto.
    await requestUpload(`/api/reports/${report.id}/receipts`, [
      {
        buffer: await makeQrReceiptPdf({
          accessKey: NOTA_163119,
          date: '17/06/2026',
          total: '48,60',
        }),
        filename: 'dia17.pdf',
      },
      {
        buffer: await makeQrReceiptPdf({
          accessKey: NOTA_163160,
          date: '23/06/2026',
          total: '48,60',
        }),
        filename: 'dia23.pdf',
      },
    ]);

    const { data, meta } = await listReceipts(report.id);

    expect(data).toHaveLength(2);
    expect(data.every((receipt) => receipt.status !== 'duplicate')).toBe(true);

    // E, principalmente: os dois somam. Regra agressiva demais recria o erro
    // que a ferramenta existe para evitar.
    expect(data.map((receipt) => receipt.amount_cents)).toEqual([4860, 4860]);
    expect(meta.total).toBe(2);
  });

  it('nao sugere duplicata para notas fiscais distintas no mesmo dia', async () => {
    const report = await insertReport();

    await insertReceipt(report.id, {
      page_number: 1,
      issued_at: '2026-06-17',
      amount_cents: 4860,
      access_key: NOTA_163119,
    });
    await insertReceipt(report.id, {
      page_number: 2,
      issued_at: '2026-06-17',
      amount_cents: 4860,
      access_key: NOTA_163160,
    });

    const response = await request(
      'GET',
      `/api/reports/${report.id}/validation`,
    );

    // Chaves diferentes sao documentos diferentes por definicao: nem suspeita
    // ha. Sem isso, restaurante de preco fixo viraria uma enxurrada de alertas.
    const suspeitas = response.body.data.filter(
      (alerta) => alerta.rule === 'possivel_duplicata',
    );

    expect(suspeitas).toHaveLength(0);
  });
});

describe('duplicata provavel', () => {
  it('vira alerta, nunca exclusao silenciosa', async () => {
    const report = await insertReport();

    // Cupom e comprovante de cartao: mesma data, mesmo valor, documentos de
    // tipos diferentes, sem chave nos dois.
    // `needs_review` e o estado de quem ja passou pela extracao: inserir como
    // `pending` deixaria o teste esperando uma fila que nunca vai rodar.
    const first = await insertReceipt(report.id, {
      page_number: 1,
      issued_at: '2026-06-20',
      amount_cents: 598,
      status: 'needs_review',
    });
    const second = await insertReceipt(report.id, {
      page_number: 2,
      issued_at: '2026-06-20',
      amount_cents: 598,
      status: 'needs_review',
    });

    const response = await request(
      'GET',
      `/api/reports/${report.id}/validation`,
    );

    const suspeitas = response.body.data.filter(
      (alerta) => alerta.rule === 'possivel_duplicata',
    );

    expect(suspeitas).toHaveLength(1);
    // Pode ser o mesmo gasto, pode nao ser: quem decide e uma pessoa.
    expect(suspeitas[0].level).toBe('decisao');
    // O alerta liga os dois comprovantes, e nao so traz o campo preenchido.
    expect([suspeitas[0].receipt_id, suspeitas[0].related_id].sort()).toEqual(
      [first.id, second.id].sort(),
    );

    // Nada foi marcado nem removido: quem decide e a pessoa.
    const lista = await listReceipts(report.id);
    expect(lista.data.every((receipt) => receipt.status !== 'duplicate')).toBe(
      true,
    );
  });
});
