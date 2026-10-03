'use strict';

const {
  request,
  insertReport,
  insertTask,
  startApiInstance,
} = require('../orchestrator');

/**
 * O limitador fica desligado na instancia que a suite usa — ela trombaria em
 * qualquer teto realista. Aqui cada teste sobe uma instancia propria, com o
 * limitador ligado e tetos baixos, e conta as respostas.
 *
 * Uma instancia por teste, e nao por arquivo: o contador vive na memoria do
 * processo e so zera no fim da janela, entao um teste herdaria o que o
 * anterior gastou.
 */
const LIMITS = {
  RATE_LIMIT_ENABLED: 'true',
  RATE_LIMIT_WRITE_MAX: '3',
  RATE_LIMIT_BATCH_WRITE_MAX: '6',
};

let instance = null;

// Subir um processo novo pode passar do teto padrao de 15 s do Jest quando o
// disco esta disputado — ver `startApiInstance`.
beforeEach(async () => {
  instance = await startApiInstance(LIMITS);
}, 70000);

afterEach(async () => {
  await instance?.stop();
  instance = null;
});

/** Manda `times` requisicoes em sequencia e devolve as respostas. */
async function repeat(times, send) {
  const responses = [];

  for (let attempt = 0; attempt < times; attempt += 1) {
    responses.push(await send(attempt));
  }

  return responses;
}

function patch(path, body) {
  return request('PATCH', path, body, { baseUrl: instance.baseUrl });
}

describe('tetos de escrita', () => {
  it('prestacao de contas tem teto proprio, e nao divide o geral', async () => {
    const report = await insertReport();

    const responses = await repeat(7, (attempt) =>
      patch(`/api/reports/${report.id}`, { title: `Viagem ${attempt}` }),
    );

    // Com o geral somado ao de lote, a quarta escrita ja voltava 429.
    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 200, 200, 200, 200, 429,
    ]);
    expect(responses[6].body).toMatchObject({
      name: 'TooManyRequestsError',
      status_code: 429,
    });
  });

  it('fora da prestacao de contas vale o teto geral', async () => {
    const task = await insertTask();

    const responses = await repeat(4, (attempt) =>
      patch(`/api/tasks/${task.id}`, { title: `Tarefa ${attempt}` }),
    );

    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 200, 429,
    ]);
  });

  it('esgotar um teto nao corta a outra familia de rota', async () => {
    const task = await insertTask();
    const report = await insertReport();

    const tasks = await repeat(4, (attempt) =>
      patch(`/api/tasks/${task.id}`, { title: `Tarefa ${attempt}` }),
    );
    const reports = await repeat(3, (attempt) =>
      patch(`/api/reports/${report.id}`, { title: `Viagem ${attempt}` }),
    );

    expect(tasks.at(-1).status).toBe(429);
    expect(reports.map((response) => response.status)).toEqual([200, 200, 200]);
  });

  it('leitura nao gasta teto de escrita', async () => {
    const report = await insertReport();

    await repeat(8, () =>
      request('GET', `/api/reports/${report.id}`, undefined, {
        baseUrl: instance.baseUrl,
      }),
    );
    const write = await patch(`/api/reports/${report.id}`, {
      title: 'Depois das leituras',
    });

    expect(write.status).toBe(200);
  });
});
