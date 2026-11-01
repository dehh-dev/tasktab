'use strict';

const {
  request,
  requestUpload,
  insertRpaLaunch,
  insertRpaWorker,
  insertRpaPayment,
  startApiInstance,
} = require('../../orchestrator');
const { formResponse, makeFormXlsx } = require('../../fixtures/forms');
const { QUESTIONS, photo, makeDriveZip } = require('../../fixtures/drive');
const { makeScannedRpaReceipts } = require('../../fixtures/rpa-receipts');

/**
 * Criterio das issues 37, 41 e 42: nenhum CPF, PIS, RG, conta, nome de
 * pessoa ou de arquivo no log. A instancia principal da suite tem o log mudo;
 * esta sobe com o log ligado, e o teste le a saida dela depois de mexer na
 * equipe, nos documentos e nos recibos pela API.
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

  it('enviar os documentos nao deixa nome de arquivo nem de pessoa no log', async () => {
    const launch = await insertRpaLaunch();
    await insertRpaWorker({
      launch_id: launch.id,
      name: 'Pessoa Sintetica Documentada',
    });
    const before = instance.output().length;
    const answered = (await logLines(0)).filter((line) => line.res).length;

    const response = await requestUpload(
      `/api/rpa/launches/${launch.id}/documents`,
      [
        {
          buffer: await makeDriveZip([
            {
              question: QUESTIONS.ctpsFront,
              name: 'FOTO_UNICA_7781 - Pessoa Documentada.jpg',
              data: await photo(1),
            },
            {
              question: QUESTIONS.address,
              name: 'CONTA_UNICA_7782 - Conta Sem Cadastro.jpg',
              data: await photo(2),
            },
          ]),
          filename: 'ZIP_UNICO_7783.zip',
        },
      ],
      { field: 'file', baseUrl: instance.baseUrl },
    );
    expect(response.status).toBe(200);

    // A linha do envio chegou antes de conferir o que nao saiu.
    const lines = await logLines(answered + 1);
    expect(lines.find((line) => line.msg === 'documentos importados')).toEqual(
      expect.objectContaining({ launch_id: launch.id, stored: 2, created: 2 }),
    );

    const output = instance.output().slice(before);
    expect(
      [
        'FOTO_UNICA_7781',
        'CONTA_UNICA_7782',
        'ZIP_UNICO_7783',
        'Pessoa Documentada',
        'Conta Sem Cadastro',
        'Documentada',
        'File responses',
      ].filter((value) => output.includes(value)),
    ).toEqual([]);
  });

  it('ler os recibos assinados nao deixa CPF nem nome no log', async () => {
    const launch = await insertRpaLaunch();
    const worker = await insertRpaWorker({
      launch_id: launch.id,
      name: 'Recebedora Sintetica Assinante',
    });
    await insertRpaPayment({ worker_id: worker.id });
    const before = instance.output().length;

    const response = await requestUpload(
      `/api/rpa/launches/${launch.id}/receipts?payment=1`,
      [
        {
          buffer: await makeScannedRpaReceipts([
            { name: 'RECEBEDORA SINTETICA ASSINANTE', cpf: worker.cpf },
          ]),
          filename: 'RPCI_UNICO_7791.pdf',
        },
      ],
      { field: 'file', baseUrl: instance.baseUrl },
    );
    expect(response.status).toBe(202);

    // A leitura e na fila desta instancia: espera o envio terminar.
    const deadline = Date.now() + 60000;
    let batch;
    do {
      await new Promise((resolve) => setTimeout(resolve, 200));
      batch = await request(
        'GET',
        `/api/rpa/receipt-batches/${response.body.data.id}`,
        undefined,
        { baseUrl: instance.baseUrl },
      );
    } while (
      ['pending', 'processing'].includes(batch.body.data.status) &&
      Date.now() < deadline
    );
    expect(batch.body.data.status).toBe('done');
    expect(batch.body.data.result.matched).toHaveLength(1);

    const output = instance.output().slice(before);
    expect(output).toContain('recibos lidos');
    expect(
      [
        worker.cpf,
        worker.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'),
        'RECEBEDORA',
        'Recebedora',
        'Assinante',
        'RPCI_UNICO_7791',
        '650,00',
      ].filter((value) => output.includes(value)),
    ).toEqual([]);
  }, 90000);
});
