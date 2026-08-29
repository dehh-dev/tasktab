'use strict';

const {
  requestUpload,
  request,
  insertReport,
  insertMerchant,
  waitForProcessing,
} = require('../../orchestrator');
const { makeReceiptPdf, makeQrReceiptPdf } = require('../../fixtures/pdf');

const CNPJ = '26048802000165';
const CHAVE = '52260626048802000165650010001631601303284889';

async function upload(reportId, files) {
  return requestUpload(`/api/reports/${reportId}/receipts`, files);
}

async function listReceipts(reportId) {
  // O upload responde 202: o conteudo so existe depois que a fila roda.
  await waitForProcessing(reportId);
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

    // Sem cadastro, a categoria vem de palpite e chega marcada como tal. O que
    // o cadastro decide e o que vale sem marca nenhuma.
    expect(receipt.category_guessed).toBe(true);
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

    // O emitente so existe depois que a fila processa o primeiro cupom.
    await waitForProcessing(report.id);

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

    // CNPJ invalido nao vira cadastro. O palpite pelo nome e independente
    // disso: ele nunca dependeu do CNPJ, e por isso continua preenchido.
    expect(receipt.merchant_id).toBeNull();
    expect(receipt.category_guessed).toBe(true);

    const lista = await request('GET', '/api/merchants');
    expect(lista.body.data).toHaveLength(0);
  });

  it('adivinha a categoria pelo nome, marcada como palpite', async () => {
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

    // "Restaurante" no nome vira alimentacao — mas **marcada**. A marca e o
    // contrato inteiro desta funcionalidade: sem ela o palpite chegaria na
    // revisao com a mesma cara de um dado lido do documento, e e nesse ponto
    // que uma planilha errada passa despercebida.
    expect(receipt.category).toBe('alimentacao');
    expect(receipt.category_guessed).toBe(true);
    expect(receipt.status).toBe('needs_review');
  });

  it('nao adivinha o que o nome nao diz', async () => {
    const report = await insertReport();

    await upload(report.id, [
      {
        buffer: await makeReceiptPdf({
          name: 'K B A TEIXEIRA COMERCIO E SERVICOS LTDA',
          cnpj: '20.305.961/0001-11',
        }),
        filename: 'generico.pdf',
      },
    ]);

    const [receipt] = await listReceipts(report.id);

    // Razao social que nao diz o que foi comprado continua sem categoria.
    // Preencher **mesmo sem certeza** e preencher quando ha indicio, nao
    // sortear um tipo para nao deixar o campo vazio.
    expect(receipt.category).toBeNull();
    expect(receipt.category_guessed).toBe(false);
  });

  it('palpite nunca sobrescreve a categoria ja cadastrada no emitente', async () => {
    const report = await insertReport();
    const cnpj = '20305961000111';

    // O emitente tem "restaurante" no nome, e cadastro dizendo outra coisa.
    await insertMerchant({
      cnpj,
      name: 'RESTAURANTE DO POSTO',
      default_category: 'combustivel',
    });

    await upload(report.id, [
      {
        buffer: await makeReceiptPdf({
          name: 'RESTAURANTE DO POSTO',
          cnpj: '20.305.961/0001-11',
        }),
        filename: 'posto.pdf',
      },
    ]);

    const [receipt] = await listReceipts(report.id);

    // Cadastro e decisao registrada por uma pessoa; palpite e palavra-chave.
    // Deixar o palpite vencer desfaria a classificacao que alguem ja fez.
    expect(receipt.category).toBe('combustivel');
    expect(receipt.category_guessed).toBe(false);
  });
});
