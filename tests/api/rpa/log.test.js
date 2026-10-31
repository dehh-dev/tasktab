'use strict';

const {
  request,
  requestUpload,
  insertRpaLaunch,
  startApiInstance,
} = require('../../orchestrator');
const { formResponse, makeFormXlsx } = require('../../fixtures/forms');

/**
 * Criterio da issue 37: nenhum CPF, PIS, RG ou conta no log. A instancia
 * principal da suite tem o log mudo; esta sobe com o log ligado, e o teste le
 * a saida dela depois de importar e corrigir a equipe pela API.
 */
let instance = null;

// Subir um processo novo pode passar do teto padrao de 15 s do Jest quando o
// disco esta disputado — ver `startApiInstance`.
beforeAll(async () => {
  instance = await startApiInstance({ LOG_LEVEL: 'info' });
}, 70000);

afterAll(async () => {
  await instance?.stop();
});

/**
 * O log chega do outro processo por um pipe, depois da resposta: espera ate
 * cada requisicao ter a sua linha.
 */
async function logLines(requests) {
  const deadline = Date.now() + 5000;
  let lines = [];

  while (Date.now() < deadline) {
    lines = instance
      .output()
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    if (lines.filter((line) => line.res).length >= requests) return lines;

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`o log nao trouxe as ${requests} requisicoes a tempo`);
}

describe('o log do RPA', () => {
  it('importar e corrigir a equipe nao deixa dado pessoal no log', async () => {
    const launch = await insertRpaLaunch({
      city: 'Avaré',
      state: 'SP',
      starts_on: '2026-10-13',
      ends_on: '2026-11-30',
    });
    const responses = [formResponse(1), formResponse(2)];
    const baseUrl = instance.baseUrl;

    const imported = await requestUpload(
      `/api/rpa/launches/${launch.id}/import`,
      [{ buffer: await makeFormXlsx(responses), filename: 'respostas.xlsx' }],
      { field: 'file', baseUrl },
    );
    expect(imported.status).toBe(200);

    const [first, second] = imported.body.data.workers;

    // Um erro de validacao com o CPF de outra pessoa, e uma correcao aceita.
    const conflict = await request(
      'PATCH',
      `/api/rpa/workers/${second.id}`,
      { cpf: first.cpf },
      { baseUrl },
    );
    expect(conflict.status).toBe(422);

    const fixed = await request(
      'PATCH',
      `/api/rpa/workers/${second.id}`,
      { account: '7654321-0', rg: '99887766' },
      { baseUrl },
    );
    expect(fixed.status).toBe(200);

    const lines = await logLines(3);

    expect(lines.find((line) => line.msg === 'equipe importada')).toEqual(
      expect.objectContaining({
        launch_id: launch.id,
        created: 2,
        updated: 0,
        rejected: 0,
      }),
    );

    const output = instance.output();
    const personal = [
      '7654321-0',
      '99887766',
      ...responses.flatMap((response) => [
        response.cpf,
        response.pis,
        response.rg,
        response.account,
        response.name,
        response.mother_name,
        response.email,
      ]),
    ];

    expect(personal.filter((value) => output.includes(value))).toEqual([]);
  });
});
