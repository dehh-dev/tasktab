'use strict';

const { request, insertMerchant } = require('../../orchestrator');

// CNPJ com verificador valido, usado no caso-base.
const CNPJ = '26048802000165';
const MASCARADO = '26.048.802/0001-65';

describe('POST /api/merchants', () => {
  it('cadastra um emitente', async () => {
    const response = await request('POST', '/api/merchants', {
      cnpj: CNPJ,
      name: 'Franguinho na Panela',
      default_category: 'alimentacao',
      city: 'Abadiania',
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      cnpj: CNPJ,
      name: 'Franguinho na Panela',
      default_category: 'alimentacao',
    });
    expect(response.headers.get('location')).toBe(
      `/api/merchants/${response.body.data.id}`,
    );
  });

  it('aceita CNPJ com mascara e grava so os digitos', async () => {
    const response = await request('POST', '/api/merchants', {
      cnpj: MASCARADO,
      name: 'Com mascara',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.cnpj).toBe(CNPJ);
  });

  it('aplica nao_classificado quando a categoria nao vem', async () => {
    const response = await request('POST', '/api/merchants', {
      cnpj: CNPJ,
      name: 'Sem categoria',
    });

    expect(response.body.data.default_category).toBe('nao_classificado');
  });

  it('recusa CNPJ com digito verificador invalido', async () => {
    const invalido = `${CNPJ.slice(0, 13)}${(Number(CNPJ[13]) + 1) % 10}`;

    const response = await request('POST', '/api/merchants', {
      cnpj: invalido,
      name: 'Digito errado',
    });

    expect(response.status).toBe(422);
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'cnpj' }),
    );
  });

  it('recusa sequencia repetida, que fecha a conta por acidente', async () => {
    const response = await request('POST', '/api/merchants', {
      cnpj: '11111111111111',
      name: 'Sequencia',
    });

    expect(response.status).toBe(422);
  });

  it('recusa CNPJ com menos de 14 digitos', async () => {
    const response = await request('POST', '/api/merchants', {
      cnpj: '2604880200016',
      name: 'Curto',
    });

    expect(response.status).toBe(422);
  });

  it('recusa duplicata com 422, e nao com 500 de unique', async () => {
    await insertMerchant({ cnpj: CNPJ });

    const response = await request('POST', '/api/merchants', {
      cnpj: MASCARADO,
      name: 'Repetido',
    });

    expect(response.status).toBe(422);
    expect(response.body.name).toBe('ValidationError');
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'cnpj' }),
    );
  });

  it('exige nome', async () => {
    const response = await request('POST', '/api/merchants', { cnpj: CNPJ });

    expect(response.status).toBe(422);
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'name' }),
    );
  });
});

describe('GET /api/merchants', () => {
  it('lista os emitentes cadastrados', async () => {
    await insertMerchant({ cnpj: CNPJ, name: 'Um' });
    await insertMerchant({ cnpj: '20305961000111', name: 'Outro' });

    const response = await request('GET', '/api/merchants');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta.total).toBe(2);
  });
});

describe('GET /api/merchants/by-cnpj/:cnpj', () => {
  it('encontra pelo CNPJ, com ou sem mascara', async () => {
    await insertMerchant({ cnpj: CNPJ, default_category: 'alimentacao' });

    const semMascara = await request('GET', `/api/merchants/by-cnpj/${CNPJ}`);
    expect(semMascara.status).toBe(200);
    expect(semMascara.body.data.default_category).toBe('alimentacao');

    const comMascara = await request(
      'GET',
      `/api/merchants/by-cnpj/${encodeURIComponent(MASCARADO)}`,
    );
    expect(comMascara.status).toBe(200);
  });

  it('retorna 404 quando o CNPJ nao esta cadastrado', async () => {
    const response = await request('GET', `/api/merchants/by-cnpj/${CNPJ}`);

    expect(response.status).toBe(404);
    expect(response.body.action).toMatch(/[Cc]adastre/);
  });

  it('retorna 400 para CNPJ malformado', async () => {
    const response = await request('GET', '/api/merchants/by-cnpj/abc');

    expect(response.status).toBe(400);
  });
});

describe('PATCH /api/merchants/:id', () => {
  it('atualiza a categoria padrao do emitente', async () => {
    const merchant = await insertMerchant();

    const response = await request('PATCH', `/api/merchants/${merchant.id}`, {
      default_category: 'alimentacao',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.default_category).toBe('alimentacao');
  });

  it('nao permite trocar o CNPJ, que e a identidade do emitente', async () => {
    const merchant = await insertMerchant();

    const response = await request('PATCH', `/api/merchants/${merchant.id}`, {
      cnpj: '20305961000111',
    });

    expect(response.status).toBe(422);
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'body' }),
    );
  });

  it('retorna 404 para id inexistente', async () => {
    const response = await request('PATCH', '/api/merchants/999999', {
      name: 'Fantasma',
    });

    expect(response.status).toBe(404);
  });
});
