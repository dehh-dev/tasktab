'use strict';

const {
  request,
  insertReport,
  insertReceipt,
  insertMerchant,
  updateColumnDirectly,
} = require('../../orchestrator');

const COMPLETO = {
  issued_at: '2026-06-19',
  amount_cents: 3760,
  category: 'alimentacao',
};

describe('PATCH /api/receipts/:id', () => {
  it('corrige os campos da revisao', async () => {
    const report = await insertReport();
    const receipt = await insertReceipt(report.id);

    const response = await request(
      'PATCH',
      `/api/receipts/${receipt.id}`,
      COMPLETO,
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject(COMPLETO);
  });

  it('marca a origem como manual ao corrigir a mao', async () => {
    const report = await insertReport();
    const receipt = await insertReceipt(report.id);

    const response = await request('PATCH', `/api/receipts/${receipt.id}`, {
      amount_cents: 5980,
    });

    // E o que permite a revisao destacar o que veio de OCR e o que ja foi
    // olhado por uma pessoa.
    expect(response.body.data.extraction_source).toBe('manual');
  });

  it('confirma quando data, valor e categoria estao preenchidos', async () => {
    const report = await insertReport();
    const receipt = await insertReceipt(report.id);

    const response = await request('PATCH', `/api/receipts/${receipt.id}`, {
      ...COMPLETO,
      status: 'confirmed',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('confirmed');
  });

  it('confirma usando o que ja estava gravado', async () => {
    const report = await insertReport();
    const receipt = await insertReceipt(report.id, COMPLETO);

    const response = await request('PATCH', `/api/receipts/${receipt.id}`, {
      status: 'confirmed',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('confirmed');
  });

  it('recusa confirmar sem valor', async () => {
    const report = await insertReport();
    const receipt = await insertReceipt(report.id, {
      issued_at: '2026-06-19',
      category: 'alimentacao',
    });

    const response = await request('PATCH', `/api/receipts/${receipt.id}`, {
      status: 'confirmed',
    });

    expect(response.status).toBe(422);
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'amount_cents' }),
    );
  });

  it('recusa confirmar sem data nem categoria, apontando os dois campos', async () => {
    const report = await insertReport();
    const receipt = await insertReceipt(report.id, { amount_cents: 3760 });

    const response = await request('PATCH', `/api/receipts/${receipt.id}`, {
      status: 'confirmed',
    });

    expect(response.status).toBe(422);
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'issued_at' }),
    );
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'category' }),
    );
  });

  it('rejeita valor em reais, que nao e inteiro de centavos', async () => {
    const report = await insertReport();
    const receipt = await insertReceipt(report.id);

    const response = await request('PATCH', `/api/receipts/${receipt.id}`, {
      amount_cents: 37.6,
    });

    expect(response.status).toBe(422);
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'amount_cents' }),
    );
  });

  it('rejeita data inexistente no calendario', async () => {
    const report = await insertReport();
    const receipt = await insertReceipt(report.id);

    const response = await request('PATCH', `/api/receipts/${receipt.id}`, {
      issued_at: '2026-02-31',
    });

    expect(response.status).toBe(422);
  });
});

// Quando o QR e o texto falham, a chave some — e e ela que o procedimento
// chama de fonte da verdade para emitente e data. Digitada na revisao, o DV
// decide se ela vale.
describe('PATCH /api/receipts/:id com a chave de acesso digitada', () => {
  const CHAVE = '52260626048802000165650010001631601303284889';
  const CNPJ_DA_CHAVE = '26048802000165';

  function patch(receipt, body) {
    return request('PATCH', `/api/receipts/${receipt.id}`, body);
  }

  it('chave que nao fecha o DV e 422 no campo, e nada e gravado', async () => {
    const receipt = await insertReceipt((await insertReport()).id);
    const quebrada = `${CHAVE.slice(0, 43)}${(Number(CHAVE[43]) + 1) % 10}`;

    const response = await patch(receipt, { access_key: quebrada });

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      {
        field: 'access_key',
        message: 'access_key nao fecha o digito verificador',
      },
    ]);
    const lido = await request('GET', `/api/receipts/${receipt.id}`);
    expect(lido.body.data.access_key).toBeNull();
  });

  it('chave fora do formato e 422 no campo', async () => {
    const receipt = await insertReceipt((await insertReport()).id);

    const response = await patch(receipt, { access_key: '5226 0626' });

    expect(response.status).toBe(422);
    expect(response.body.details[0].field).toBe('access_key');
  });

  it('aceita a chave como e impressa, em grupos, e grava os 44 caracteres', async () => {
    const receipt = await insertReceipt((await insertReport()).id);
    const impressa = CHAVE.match(/.{1,4}/g).join(' ');

    const response = await patch(receipt, { access_key: impressa });

    expect(response.status).toBe(200);
    expect(response.body.data.access_key).toBe(CHAVE);
    expect(response.body.data.extraction_source).toBe('manual');
  });

  it('vincula o emitente pelo CNPJ da chave, cadastrando o desconhecido', async () => {
    const receipt = await insertReceipt((await insertReport()).id);

    const response = await patch(receipt, { access_key: CHAVE });
    const emitente = await request(
      'GET',
      `/api/merchants/${response.body.data.merchant_id}`,
    );

    expect(emitente.body.data.cnpj).toBe(CNPJ_DA_CHAVE);
  });

  it('a categoria do cadastro substitui o palpite', async () => {
    const merchant = await insertMerchant({
      cnpj: CNPJ_DA_CHAVE,
      default_category: 'alimentacao',
    });
    const receipt = await insertReceipt((await insertReport()).id, {
      category: 'outros',
    });
    await updateColumnDirectly(
      'receipts',
      receipt.id,
      'category_guessed',
      true,
    );

    const response = await patch(receipt, { access_key: CHAVE });

    expect(response.body.data).toMatchObject({
      merchant_id: merchant.id,
      category: 'alimentacao',
      category_guessed: false,
    });
  });

  it('confirmar pela tela com a chave digitada troca o palpite pela categoria do cadastro', async () => {
    const merchant = await insertMerchant({
      cnpj: CNPJ_DA_CHAVE,
      default_category: 'combustivel',
    });
    const receipt = await insertReceipt((await insertReport()).id, {
      category: 'alimentacao',
    });
    await updateColumnDirectly(
      'receipts',
      receipt.id,
      'category_guessed',
      true,
    );

    // O corpo que a revisao manda ao confirmar: a categoria vai junto, como
    // veio da extracao, mesmo que ninguem tenha mexido nela.
    const response = await patch(receipt, {
      ...COMPLETO,
      category: 'alimentacao',
      status: 'confirmed',
      access_key: CHAVE,
    });

    expect(response.body.data).toMatchObject({
      merchant_id: merchant.id,
      category: 'combustivel',
      category_guessed: false,
      status: 'confirmed',
    });
  });

  it('outra categoria no mesmo PATCH e escolha da pessoa, e fica', async () => {
    await insertMerchant({
      cnpj: CNPJ_DA_CHAVE,
      default_category: 'combustivel',
    });
    const receipt = await insertReceipt((await insertReport()).id, {
      category: 'alimentacao',
    });
    await updateColumnDirectly(
      'receipts',
      receipt.id,
      'category_guessed',
      true,
    );

    const response = await patch(receipt, {
      ...COMPLETO,
      category: 'transporte',
      status: 'confirmed',
      access_key: CHAVE,
    });

    expect(response.body.data.category).toBe('transporte');
  });

  it('a categoria escolhida por uma pessoa fica, mesmo com cadastro', async () => {
    await insertMerchant({
      cnpj: CNPJ_DA_CHAVE,
      default_category: 'alimentacao',
    });
    const receipt = await insertReceipt((await insertReport()).id, {
      category: 'combustivel',
    });

    const response = await patch(receipt, { access_key: CHAVE });

    expect(response.body.data.category).toBe('combustivel');
  });

  it('a mesma chave de outro comprovante do relatorio faz deste a duplicata', async () => {
    const report = await insertReport();
    const original = await insertReceipt(report.id, {
      page_number: 1,
      status: 'needs_review',
      access_key: CHAVE,
    });
    const repetido = await insertReceipt(report.id, { page_number: 2 });

    // Mesmo pedindo para confirmar: e o mesmo documento fiscal, e somar os
    // dois e o erro que a ferramenta existe para evitar.
    const response = await patch(repetido, {
      ...COMPLETO,
      status: 'confirmed',
      access_key: CHAVE,
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      status: 'duplicate',
      duplicate_of_id: original.id,
    });
  });

  it('a mesma chave em outro relatorio nao e duplicata', async () => {
    await insertReceipt((await insertReport()).id, { access_key: CHAVE });
    const receipt = await insertReceipt(
      (await insertReport({ title: 'Outra viagem' })).id,
    );

    const response = await patch(receipt, {
      ...COMPLETO,
      status: 'confirmed',
      access_key: CHAVE,
    });

    expect(response.body.data.status).toBe('confirmed');
  });
});

// Recibo sem CNPJ legivel saia na planilha sem nome e sem cidade. Decisao de
// quem usa: procurar no proprio comprovante — e a cidade e a do documento,
// nunca a do destino da viagem.
describe('PATCH /api/receipts/:id com o emitente lido do proprio comprovante', () => {
  const CHAVE = '52260626048802000165650010001631601303284889';

  function patch(receipt, body) {
    return request('PATCH', `/api/receipts/${receipt.id}`, body);
  }

  it('grava nome e cidade como estao no papel', async () => {
    const receipt = await insertReceipt((await insertReport()).id);

    const response = await patch(receipt, {
      issuer_name: '  Restaurante da Dona Maria ',
      issuer_city: 'Itapipoca/CE',
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      issuer_name: 'Restaurante da Dona Maria',
      issuer_city: 'Itapipoca/CE',
      extraction_source: 'manual',
    });
  });

  it('nome vazio vira nulo, e longo demais e 422 no campo', async () => {
    const receipt = await insertReceipt((await insertReport()).id);

    const vazio = await patch(receipt, { issuer_name: '   ' });
    const longo = await patch(receipt, { issuer_name: 'x'.repeat(256) });

    expect(vazio.body.data.issuer_name).toBeNull();
    expect(longo.status).toBe(422);
    expect(longo.body.details[0].field).toBe('issuer_name');
  });

  it('cnpj vincula o emitente, cadastrado com o nome do papel', async () => {
    const receipt = await insertReceipt((await insertReport()).id);

    const response = await patch(receipt, {
      cnpj: '26.048.802/0001-65',
      issuer_name: 'Padaria Imperial',
    });
    const emitente = await request(
      'GET',
      `/api/merchants/${response.body.data.merchant_id}`,
    );

    expect(emitente.body.data).toMatchObject({
      cnpj: '26048802000165',
      name: 'Padaria Imperial',
    });
  });

  it('cnpj que nao fecha o verificador e 422 no campo', async () => {
    const receipt = await insertReceipt((await insertReport()).id);

    const response = await patch(receipt, { cnpj: '26.048.802/0001-66' });

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      { field: 'cnpj', message: 'cnpj tem digito verificador invalido' },
    ]);
  });

  it('com chave de acesso no comprovante, o cnpj vem dela', async () => {
    const receipt = await insertReceipt((await insertReport()).id, {
      access_key: CHAVE,
    });

    const response = await patch(receipt, { cnpj: '58.080.015/0001-97' });

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      {
        field: 'cnpj',
        message: 'cnpj vem da chave de acesso deste comprovante',
      },
    ]);
  });

  it('remover a chave e informar o cnpj no mesmo PATCH vale', async () => {
    const receipt = await insertReceipt((await insertReport()).id, {
      access_key: CHAVE,
    });

    // A guarda olhava a chave de antes do PATCH, que este mesmo PATCH remove.
    const response = await patch(receipt, {
      access_key: null,
      cnpj: '58.080.015/0001-97',
    });
    const emitente = await request(
      'GET',
      `/api/merchants/${response.body.data.merchant_id}`,
    );

    expect(response.status).toBe(200);
    expect(response.body.data.access_key).toBeNull();
    expect(emitente.body.data.cnpj).toBe('58080015000197');
  });

  it('cnpj nulo desvincula o emitente', async () => {
    // O CNPJ lido do texto pode ser o da credenciadora do cartao.
    const merchant = await insertMerchant();
    const receipt = await insertReceipt((await insertReport()).id, {
      merchant_id: merchant.id,
    });

    const response = await patch(receipt, { cnpj: null });

    expect(response.body.data.merchant_id).toBeNull();
  });
});

// "Pagina de cabeca para baixo. Acontece." O giro fica no comprovante, e nao
// no arquivo, que e evidencia e nao se regrava.
describe('PATCH /api/receipts/:id com o giro da pagina', () => {
  it('grava o quarto de volta sem marcar a origem como manual', async () => {
    const receipt = await insertReceipt((await insertReport()).id);

    const response = await request('PATCH', `/api/receipts/${receipt.id}`, {
      rotation: 90,
    });

    // Girar nao muda valor lido, e e o passo antes de reprocessar: com a
    // marca, o reprocessamento pediria para descartar uma conferencia que
    // ninguem fez.
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      rotation: 90,
      extraction_source: null,
    });
  });

  it('giro que nao e quarto de volta e 422 no campo', async () => {
    const receipt = await insertReceipt((await insertReport()).id);

    const response = await request('PATCH', `/api/receipts/${receipt.id}`, {
      rotation: 45,
    });

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      { field: 'rotation', message: 'rotation deve ser 0, 90, 180 ou 270' },
    ]);
  });
});
