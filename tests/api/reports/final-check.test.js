'use strict';

const { checkDigit } = require('../../../src/services/extraction/access-key');
const { makeCorruptPdf, makePdf } = require('../../fixtures/pdf');
const {
  request,
  insertReport,
  insertReceipt,
  insertMerchant,
  saveUpload,
} = require('../../orchestrator');

/** Uma chave que fecha o DV, de junho de 2026 e do Ceara. */
function chave() {
  const sem = '2326062604880200016565001000163160130328488';
  return `${sem}${checkDigit(sem)}`;
}

/**
 * Um relatorio com uma pagina por comprovante, num arquivo de verdade no
 * disco: a checagem monta os PDFs por categoria para contar as paginas.
 */
async function relatorio(paginas, report = {}) {
  const created = await insertReport(report);
  const upload = saveUpload(await makePdf({ pages: paginas.length }));

  for (const [index, overrides] of paginas.entries()) {
    await insertReceipt(created.id, {
      ...upload,
      page_number: index + 1,
      status: 'confirmed',
      category: 'alimentacao',
      issued_at: '2026-06-19',
      amount_cents: 1000,
      ...overrides,
    });
  }

  return created;
}

async function checagem(reportId) {
  return request('GET', `/api/reports/${reportId}/final-check`);
}

/** Os itens da checagem pelo nome de cada um. */
function itens(body) {
  return Object.fromEntries(body.data.map((item) => [item.check, item]));
}

describe('GET /api/reports/:id/final-check', () => {
  it('num relatorio conferido, tudo confere', async () => {
    const report = await relatorio([
      { amount_cents: 3760 },
      { amount_cents: 5200, category: 'combustivel', access_key: chave() },
    ]);

    const { status, body } = await checagem(report.id);

    expect(status).toBe(200);
    expect(body.data.map((item) => [item.check, item.ok])).toEqual([
      ['somas', true],
      ['paginas', true],
      ['chaves', true],
      ['confirmados', true],
    ]);
    expect(body.meta).toEqual({ total: 4, ok: 4 });
    expect(itens(body).somas.values_cents).toEqual({
      lines: 8960,
      total: 8960,
      by_type: 8960,
      by_city: 8960,
    });
  });

  it('as somas batem pelos mesmos grupos da planilha', async () => {
    const itapipoca = await insertMerchant({
      cnpj: '11111111000111',
      city: 'Itapipoca/CE',
    });
    const caixaAlta = await insertMerchant({
      cnpj: '22222222000122',
      city: 'ITAPIPOCA/CE',
    });
    // Sem categoria, `nao_classificado` e a mesma cidade em outra caixa: os
    // casos em que um grupo ja perdeu linha. A duplicata e o que esta em
    // revisao nao entram na planilha, e nem na soma.
    const report = await relatorio([
      { amount_cents: 1000, merchant_id: itapipoca.id },
      { amount_cents: 2000, merchant_id: caixaAlta.id },
      { amount_cents: 1500, category: null },
      { amount_cents: 2500, category: 'nao_classificado' },
      { amount_cents: 1000, status: 'duplicate' },
      { amount_cents: 700, status: 'needs_review' },
    ]);

    const { somas } = itens((await checagem(report.id)).body);

    expect(somas.ok).toBe(true);
    expect(somas.values_cents).toEqual({
      lines: 7000,
      total: 7000,
      by_type: 7000,
      by_city: 7000,
    });
  });

  it('toda pagina em exatamente um PDF de categoria, e o total bate', async () => {
    const report = await relatorio([
      {},
      { category: 'combustivel' },
      { category: null, status: 'needs_review' },
      { status: 'duplicate' },
      { category: 'outros' },
    ]);

    const { paginas } = itens((await checagem(report.id)).body);

    expect(paginas).toEqual({
      check: 'paginas',
      ok: true,
      message:
        '5 paginas recebidas, cada uma em exatamente um PDF de categoria.',
      received: 5,
      generated: 5,
    });
  });

  it('arquivo de comprovante fora do disco aparece aqui, sem derrubar o resto', async () => {
    const report = await relatorio([{}]);
    const perdido = await insertReceipt(report.id, {
      file_path: 'sumiu.pdf',
      file_hash: 'b'.repeat(64),
      page_number: 1,
      status: 'confirmed',
      category: 'alimentacao',
      issued_at: '2026-06-19',
      amount_cents: 1000,
    });

    const { status, body } = await checagem(report.id);

    // Melhor descobrir agora do que na hora de exportar a entrega.
    expect(status).toBe(200);
    expect(itens(body).paginas).toMatchObject({
      ok: false,
      received: 2,
      generated: 0,
      message: expect.stringContaining(`do comprovante ${perdido.id} `),
    });
    expect(itens(body).confirmados.ok).toBe(true);
  });

  it('PDF que nao abre aparece aqui, sem derrubar a checagem', async () => {
    const report = await relatorio([{}]);
    // Como o upload guarda o PDF protegido ou corrompido: linha `failed`, com
    // o arquivo no disco. A checagem respondia 500 e o dialogo de fechar so
    // dizia que ela nao tinha respondido.
    const ilegivel = await insertReceipt(report.id, {
      ...saveUpload(makeCorruptPdf()),
      page_number: 1,
      status: 'failed',
    });

    const { status, body } = await checagem(report.id);

    expect(status).toBe(200);
    expect(itens(body).paginas).toEqual({
      check: 'paginas',
      ok: false,
      message: `O PDF do comprovante ${ilegivel.id} nao abre: os PDFs por categoria nao saem.`,
      received: 2,
      generated: 0,
    });
  });

  it('todo arquivo fora do disco aparece de uma vez, e nao so o primeiro', async () => {
    const report = await insertReport();
    const perdidos = [];

    for (const [index, arquivo] of ['sumiu-a.pdf', 'sumiu-b.pdf'].entries()) {
      perdidos.push(
        await insertReceipt(report.id, {
          file_path: arquivo,
          file_hash: String(index + 1).repeat(64),
          page_number: 1,
          status: 'confirmed',
          category: 'alimentacao',
          issued_at: '2026-06-19',
          amount_cents: 1000,
        }),
      );
    }

    const { body } = await checagem(report.id);

    // Parava no primeiro: uma volta de reenvio para cada arquivo sumido.
    expect(itens(body).paginas.message).toBe(
      `Os arquivos dos comprovantes ${perdidos[0].id} e ${perdidos[1].id} nao estao no disco: os PDFs por categoria nao saem.`,
    );
  });

  it('aponta chave que nao fecha o digito verificador', async () => {
    const quebrada = chave().replace(/.$/, (digit) =>
      String((Number(digit) + 1) % 10),
    );
    // Sem chave nao e chave invalida: recibo e comanda nao tem chave.
    const report = await relatorio([
      { access_key: chave() },
      { access_key: quebrada },
      {},
      {},
    ]);

    expect(itens((await checagem(report.id)).body).chaves).toEqual({
      check: 'chaves',
      ok: false,
      message: '1 chave de acesso nao passa no digito verificador.',
      invalid: 1,
    });
  });

  it('aponta o que ainda nao foi confirmado por uma pessoa', async () => {
    const report = await relatorio([
      {},
      { status: 'needs_review' },
      { status: 'failed', category: null, amount_cents: null },
      // A duplicata ja foi decidida, e nao e valor da prestacao.
      { status: 'duplicate' },
    ]);

    expect(itens((await checagem(report.id)).body).confirmados).toEqual({
      check: 'confirmados',
      ok: false,
      message: '2 comprovantes ainda nao foram confirmados por uma pessoa.',
      pending: 2,
    });
  });

  it('informa, nao bloqueia: o relatorio fecha com pendencia', async () => {
    const report = await relatorio([{ status: 'needs_review' }]);

    const antes = await checagem(report.id);
    const fechado = await request('PATCH', `/api/reports/${report.id}`, {
      status: 'closed',
    });

    expect(antes.body.meta).toEqual({ total: 4, ok: 3 });
    expect(fechado.status).toBe(200);
    // Fechado, segue consultavel por quem confere depois.
    expect((await checagem(report.id)).status).toBe(200);
  });

  it('relatorio sem comprovantes nao tem o que apontar', async () => {
    const report = await insertReport();

    const { body } = await checagem(report.id);

    expect(body.meta).toEqual({ total: 4, ok: 4 });
    expect(itens(body).paginas.message).toBe('Nenhuma pagina recebida ainda.');
  });
});
