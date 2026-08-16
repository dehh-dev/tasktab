'use strict';

const {
  request,
  insertReport,
  insertReceipt,
  requestUpload,
  waitForProcessing,
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

    const { data } = await listReceipts(report.id);
    const duplicata = data.find((receipt) => receipt.status === 'duplicate');

    expect(data).toHaveLength(2);
    expect(duplicata).toBeDefined();
    expect(duplicata.duplicate_of_id).toBeDefined();
  });

  it('a duplicata continua listada, mas fora do somatorio', async () => {
    const report = await insertReport();

    await insertReceipt(report.id, {
      page_number: 1,
      amount_cents: 4860,
      category: 'alimentacao',
      status: 'confirmed',
      issued_at: '2026-06-17',
    });
    await insertReceipt(report.id, {
      page_number: 2,
      amount_cents: 4860,
      category: 'alimentacao',
      status: 'duplicate',
      issued_at: '2026-06-17',
    });

    const { data, meta } = await listReceipts(report.id);

    // Ela existe e vai no PDF consolidado; so nao soma.
    expect(data).toHaveLength(2);
    expect(meta.total_cents).toBe(4860);
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
    await insertReceipt(report.id, {
      page_number: 1,
      issued_at: '2026-06-20',
      amount_cents: 598,
      status: 'needs_review',
    });
    await insertReceipt(report.id, {
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
    expect(suspeitas[0].severity).toBe('aviso');
    expect(suspeitas[0].related_id).toBeDefined();

    // Nada foi marcado nem removido: quem decide e a pessoa.
    const lista = await listReceipts(report.id);
    expect(lista.data.every((receipt) => receipt.status !== 'duplicate')).toBe(
      true,
    );
  });
});
