'use strict';

const {
  request,
  requestUpload,
  insertRpaLaunch,
  insertRpaWorker,
} = require('../../orchestrator');
const {
  formResponse,
  makeFormXlsx,
  syntheticCpf,
} = require('../../fixtures/forms');

const LAUNCH = {
  city: 'Avaré',
  state: 'SP',
  starts_on: '2026-10-13',
  ends_on: '2026-11-30',
};

/** Importa uma pessoa pela API, para ela chegar com as pendencias reais. */
async function importOne(overrides = {}) {
  const launch = await insertRpaLaunch(LAUNCH);
  const { body } = await requestUpload(
    `/api/rpa/launches/${launch.id}/import`,
    [
      {
        buffer: await makeFormXlsx([formResponse(1, overrides)]),
        filename: 'respostas.xlsx',
      },
    ],
    { field: 'file' },
  );

  return { launch, worker: body.data.workers[0] };
}

const codes = (issues) => issues.map((entry) => `${entry.code}:${entry.field}`);

describe('GET /api/rpa/launches/:id/workers', () => {
  it('lista a equipe pelo numero fixo', async () => {
    const launch = await insertRpaLaunch();
    await insertRpaWorker({
      launch_id: launch.id,
      number: 2,
      cpf: '11144477735',
    });
    await insertRpaWorker({ launch_id: launch.id, number: 1 });

    const response = await request(
      'GET',
      `/api/rpa/launches/${launch.id}/workers`,
    );

    expect(response.status).toBe(200);
    expect(response.body.data.map((worker) => worker.number)).toEqual([1, 2]);
  });
});

describe('PATCH /api/rpa/workers/:id', () => {
  it('corrigir o campo tira a pendencia dele', async () => {
    const { worker } = await importOne({ address: 'Rua Sintetica Sem Numero' });
    expect(codes(worker.issues)).toEqual(['address_without_number:address']);

    const response = await request('PATCH', `/api/rpa/workers/${worker.id}`, {
      address: 'Rua Sintetica, 321',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.address).toBe('Rua Sintetica, 321');
    expect(response.body.data.issues).toEqual([]);
  });

  it('a nota da importacao fica enquanto o campo nao muda', async () => {
    const { worker } = await importOne({
      cpf: syntheticCpf(1, { leadingZero: true }),
    });

    const response = await request('PATCH', `/api/rpa/workers/${worker.id}`, {
      left_on: '2026-10-25',
    });

    expect(codes(response.body.data.issues)).toEqual(['cpf_padded:cpf']);
  });

  it('da a pendencia por resolvida, e ela nao volta no PATCH seguinte', async () => {
    const { worker } = await importOne({ account: '12345678901' });

    await request('PATCH', `/api/rpa/workers/${worker.id}`, {
      resolve_issues: [{ code: 'account_without_digit', field: 'account' }],
    });
    const response = await request('PATCH', `/api/rpa/workers/${worker.id}`, {
      dependents: 1,
    });

    expect(response.body.data.dependents).toBe(1);
    expect(response.body.data.issues).toEqual([
      expect.objectContaining({
        code: 'account_without_digit',
        resolved: true,
      }),
    ]);
  });

  it('mudar a data de nascimento resolve o inicio igual ao nascimento', async () => {
    const { worker } = await importOne({ birth_date: '13/10/2026' });
    expect(codes(worker.issues)).toEqual(['start_equals_birth:starts_on']);

    const response = await request('PATCH', `/api/rpa/workers/${worker.id}`, {
      birth_date: '1990-02-01',
    });

    expect(response.body.data.issues).toEqual([]);
  });

  it('inicio real, saida, promocao e dependentes', async () => {
    const worker = await insertRpaWorker();

    const response = await request('PATCH', `/api/rpa/workers/${worker.id}`, {
      starts_on: '2026-10-14',
      left_on: '2026-10-25',
      promoted_since: '2026-10-20',
      dependents: 2,
    });

    expect(response.body.data).toMatchObject({
      starts_on: '2026-10-14',
      left_on: '2026-10-25',
      promoted_since: '2026-10-20',
      dependents: 2,
    });
  });

  it.each([
    ['CPF com DV errado', { cpf: '52998224726' }, 'cpf'],
    ['saida antes do inicio', { left_on: '2026-10-01' }, 'left_on'],
    ['banco fora da lista', { bank_code: '999' }, 'bank_code'],
    ['CEP curto', { cep: '1870000' }, 'cep'],
    ['dependentes negativos', { dependents: -1 }, 'dependents'],
  ])('recusa %s com 422 no campo', async (_, body, field) => {
    const worker = await insertRpaWorker();

    const response = await request(
      'PATCH',
      `/api/rpa/workers/${worker.id}`,
      body,
    );

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([expect.objectContaining({ field })]);
  });

  it('CPF de outra pessoa do mesmo lancamento e recusado', async () => {
    const first = await insertRpaWorker();
    const second = await insertRpaWorker({
      launch_id: first.launch_id,
      number: 2,
      cpf: '11144477735',
    });

    const response = await request('PATCH', `/api/rpa/workers/${second.id}`, {
      cpf: first.cpf,
    });

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      {
        field: 'cpf',
        message: 'ja ha outra pessoa com este CPF no lancamento',
      },
    ]);
  });

  it('o numero fixo nao muda por PATCH', async () => {
    const worker = await insertRpaWorker();

    const response = await request('PATCH', `/api/rpa/workers/${worker.id}`, {
      number: 5,
    });

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      expect.objectContaining({ field: 'body' }),
    ]);
  });

  it('pessoa de lancamento encerrado nao se edita', async () => {
    const launch = await insertRpaLaunch({ status: 'closed' });
    const worker = await insertRpaWorker({ launch_id: launch.id });

    const response = await request('PATCH', `/api/rpa/workers/${worker.id}`, {
      dependents: 1,
    });

    expect(response.status).toBe(409);
  });
});
