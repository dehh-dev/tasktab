'use strict';

const {
  request,
  insertRpaCompany,
  createUserWithSession,
} = require('../../orchestrator');

// CNPJ com verificador valido, o mesmo do caso-base dos emitentes.
const CNPJ = '26048802000165';

const VALID = {
  code: 815,
  name: 'Empresa Sintetica de Empreendimentos SPE Ltda',
  cnpj: '26.048.802/0001-65',
  city: 'São João',
  state: 'sp',
};

describe('POST /api/rpa/companies', () => {
  it('cadastra a empresa pelo codigo UAU, com o CNPJ sem mascara e a UF em maiuscula', async () => {
    const response = await request('POST', '/api/rpa/companies', VALID);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      code: 815,
      name: VALID.name,
      cnpj: CNPJ,
      city: 'São João',
      state: 'SP',
      service_type: null,
      cost_center: null,
    });
    expect(response.headers.get('location')).toBe(
      `/api/rpa/companies/${response.body.data.id}`,
    );
  });

  it('aceita tipo de servico e centro de custo, que o lancamento herda', async () => {
    const response = await request('POST', '/api/rpa/companies', {
      ...VALID,
      service_type: 'Prestação de Serviços Administrativos',
      cost_center: '71401',
    });

    expect(response.body.data).toMatchObject({
      service_type: 'Prestação de Serviços Administrativos',
      cost_center: '71401',
    });
  });

  it('recusa codigo UAU repetido com 422 no campo', async () => {
    await insertRpaCompany({ code: 815 });

    const response = await request('POST', '/api/rpa/companies', VALID);

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      expect.objectContaining({ field: 'code' }),
    ]);
  });

  it('aponta de uma vez cada campo invalido', async () => {
    const response = await request('POST', '/api/rpa/companies', {
      code: '815',
      name: '  ',
      cnpj: '26048802000166',
      state: 'XX',
      cost_center: 'x'.repeat(51),
    });

    expect(response.status).toBe(422);
    expect(response.body.details.map((detail) => detail.field)).toEqual([
      'code',
      'name',
      'cnpj',
      'state',
      'cost_center',
    ]);
  });

  it('exige codigo, razao social e CNPJ', async () => {
    const response = await request('POST', '/api/rpa/companies', {});

    expect(response.status).toBe(422);
    expect(response.body.details.map((detail) => detail.field)).toEqual([
      'code',
      'name',
      'cnpj',
    ]);
  });
});

describe('GET /api/rpa/companies', () => {
  it('lista pelo codigo, com o meta da paginacao', async () => {
    await insertRpaCompany({ code: 820, name: 'Segunda' });
    await insertRpaCompany({ code: 803, name: 'Primeira' });

    const response = await request('GET', '/api/rpa/companies?limit=1');

    expect(response.status).toBe(200);
    expect(response.body.data.map((company) => company.code)).toEqual([803]);
    expect(response.body.meta).toEqual({ total: 2, limit: 1, offset: 0 });
  });

  it('mostra o detalhe', async () => {
    const company = await insertRpaCompany();

    const response = await request('GET', `/api/rpa/companies/${company.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id: company.id, code: 900 });
  });
});

describe('PATCH /api/rpa/companies/:id', () => {
  it('preenche o que a aba EMPRESA nao trazia', async () => {
    const company = await insertRpaCompany();

    const response = await request(
      'PATCH',
      `/api/rpa/companies/${company.id}`,
      {
        service_type: 'Prestação de Serviços Administrativos',
        cost_center: '71401',
      },
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      code: 900,
      service_type: 'Prestação de Serviços Administrativos',
      cost_center: '71401',
    });
  });

  it('nao troca o codigo UAU: e a identidade da empresa', async () => {
    const company = await insertRpaCompany();

    const response = await request(
      'PATCH',
      `/api/rpa/companies/${company.id}`,
      { code: 999 },
    );

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      expect.objectContaining({ field: 'body' }),
    ]);
  });

  it('esvazia campo opcional com null', async () => {
    const company = await insertRpaCompany({ city: 'Sao Joao' });

    const response = await request(
      'PATCH',
      `/api/rpa/companies/${company.id}`,
      { city: null },
    );

    expect(response.body.data.city).toBeNull();
  });
});

describe('quem alcanca o cadastro de empresas', () => {
  it('o papel user nao le nem escreve', async () => {
    const { token } = await createUserWithSession({ role: 'user' });

    const list = await request('GET', '/api/rpa/companies', undefined, {
      token,
    });
    const create = await request('POST', '/api/rpa/companies', VALID, {
      token,
    });

    expect([list.status, create.status]).toEqual([403, 403]);
    expect(list.body.message).toBe(
      'Sua conta nao tem permissao para: rpa:read.',
    );
  });

  it('o auditor le para conferir, mas nao escreve', async () => {
    const { token } = await createUserWithSession({ role: 'auditor' });

    const list = await request('GET', '/api/rpa/companies', undefined, {
      token,
    });
    const create = await request('POST', '/api/rpa/companies', VALID, {
      token,
    });

    expect([list.status, create.status]).toEqual([200, 403]);
    expect(create.body.message).toBe(
      'Sua conta nao tem permissao para: rpa:write.',
    );
  });
});
