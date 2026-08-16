'use strict';

const {
  requestUpload,
  request,
  insertReport,
  insertMerchant,
} = require('../../orchestrator');
const { makeReceiptPdf, makeQrReceiptPdf } = require('../../fixtures/pdf');

const CNPJ = '26048802000165';
const CHAVE = '52260626048802000165650010001631601303284889';

async function upload(reportId, files) {
  return requestUpload(`/api/reports/${reportId}/receipts`, files);
}

async function listReceipts(reportId) {
  const response = await request('GET', `/api/reports/${reportId}/receipts`);
  return response.body.data;
}

describe('categorizacao por emitente', () => {
  it('aplica a categoria padrao de um emitente ja cadastrado', async () => {
    await insertMerchant({ cnpj: CNPJ, default_category: 'alimentacao' });
    const report = await insertReport();

    await upload(report.id, [
      {
        buffer: await makeQrReceiptPdf({ accessKey: CHAVE }),
        filename: 'a.pdf',
      },
    ]);

    const [receipt] = await listReceipts(report.id);

    expect(receipt.category).toBe('alimentacao');
    expect(receipt.merchant_id).not.toBeNull();
  });

  it('cadastra o emitente desconhecido e manda para revisao', async () => {
    const report = await insertReport();

    await upload(report.id, [
      {
        buffer: await makeQrReceiptPdf({ accessKey: CHAVE }),
        filename: 'a.pdf',
      },
    ]);

    const [receipt] = await listReceipts(report.id);

    // Sem cadastro, a categoria fica em aberto — nunca e adivinhada.
    expect(receipt.category).toBeNull();
    expect(receipt.status).toBe('needs_review');
    expect(receipt.merchant_id).not.toBeNull();

    const merchant = await request('GET', `/api/merchants/by-cnpj/${CNPJ}`);
    expect(merchant.status).toBe(200);
    expect(merchant.body.data.default_category).toBe('nao_classificado');
  });

  it('o segundo cupom do mesmo CNPJ ja entra classificado', async () => {
    const report = await insertReport();

    // Primeiro cupom: emitente desconhecido, cadastrado sem categoria.
    await upload(report.id, [
      {
        buffer: await makeQrReceiptPdf({ accessKey: CHAVE }),
        filename: 'a.pdf',
      },
    ]);

    // O humano classifica o emitente uma vez.
    const merchant = await request('GET', `/api/merchants/by-cnpj/${CNPJ}`);
    await request('PATCH', `/api/merchants/${merchant.body.data.id}`, {
      default_category: 'alimentacao',
    });

    // Segundo cupom do mesmo emitente, arquivo diferente.
    await upload(report.id, [
      {
        buffer: await makeQrReceiptPdf({ accessKey: CHAVE, total: '48,60' }),
        filename: 'b.pdf',
      },
    ]);

    const receipts = await listReceipts(report.id);
    const segundo = receipts.find(
      (receipt) => receipt.file_path !== receipts[0].file_path,
    );

    // E aqui que a ferramenta "aprende": sem IA, so por cadastro.
    expect(segundo.category).toBe('alimentacao');
  });

  it('nao cadastra emitente quando o CNPJ nao e valido', async () => {
    const report = await insertReport();

    await upload(report.id, [
      {
        buffer: await makeReceiptPdf({ cnpj: '11.111.111/1111-11' }),
        filename: 'ruim.pdf',
      },
    ]);

    const [receipt] = await listReceipts(report.id);

    expect(receipt.merchant_id).toBeNull();
    expect(receipt.category).toBeNull();

    const lista = await request('GET', '/api/merchants');
    expect(lista.body.data).toHaveLength(0);
  });

  it('nunca adivinha categoria por nome do estabelecimento', async () => {
    const report = await insertReport();

    await upload(report.id, [
      {
        buffer: await makeReceiptPdf({
          name: 'RESTAURANTE E LANCHONETE SABOR CASEIRO',
          cnpj: '20.305.961/0001-11',
        }),
        filename: 'restaurante.pdf',
      },
    ]);

    const [receipt] = await listReceipts(report.id);

    // "Restaurante" no nome nao vira alimentacao: chutar por palavra-chave
    // acertaria a maioria e erraria em silencio a minoria.
    expect(receipt.category).toBeNull();
  });
});
