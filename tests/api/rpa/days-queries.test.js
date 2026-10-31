'use strict';

const {
  request,
  insertRow,
  insertRpaLaunch,
  insertRpaWorker,
  startApiInstance,
} = require('../../orchestrator');
const { startQueryCounter } = require('../../helpers/query-counter');
const { syntheticCpf } = require('../../fixtures/forms');

// Criterio da issue 38: gravar a grade da equipe inteira custa um numero
// constante de consultas. A LANCA da planilha era uma linha por pessoa por
// dia; aqui uma pessoa num dia e a equipe numa semana sao o mesmo PUT.
describe('PUT /api/rpa/launches/:id/days, em consultas ao banco', () => {
  let counter;
  let api;

  beforeAll(async () => {
    counter = await startQueryCounter();
    api = await startApiInstance({
      DB_HOST: counter.host,
      DB_PORT: String(counter.port),
    });
  }, 70000);

  afterAll(async () => {
    await api?.stop();
    await counter?.stop();
  });

  async function team(size) {
    const launch = await insertRpaLaunch();

    for (const weekday of [1, 2, 3, 4, 5]) {
      await insertRow('rpa_launch_schedules', {
        launch_id: launch.id,
        weekday,
        quantity: 1,
        start_time: '08:00',
        end_time: '17:00',
      });
    }

    await insertRow('rpa_rates', {
      launch_id: launch.id,
      role: 'Ajudante',
      starts_on: '2026-10-13',
      ends_on: '2026-11-30',
      daily_cents: 13000,
    });

    const workers = [];
    for (let number = 1; number <= size; number += 1) {
      workers.push(
        await insertRpaWorker({
          launch_id: launch.id,
          number,
          cpf: syntheticCpf(launch.id * 100 + number),
          role: 'Ajudante',
        }),
      );
    }

    return { launch, workers };
  }

  // Cada dia muda: excecao gravada, e as mesmas datas nos dois tamanhos.
  function week(workers, dates) {
    return workers.flatMap((worker) =>
      dates.map((date) => ({
        worker_id: worker.id,
        date,
        quantity: 1,
        start_time: '07:00',
        lunch_out: '12:00',
        lunch_in: '13:00',
        end_time: '18:00',
      })),
    );
  }

  async function consultas(launchId, days) {
    counter.reset();
    const response = await request(
      'PUT',
      `/api/rpa/launches/${launchId}/days`,
      { days },
      { baseUrl: api.baseUrl },
    );

    expect(response.status).toBe(200);
    return counter.count();
  }

  it('nao cresce com o tamanho da equipe nem com o numero de dias', async () => {
    const small = await team(1);
    const large = await team(12);
    const dates = [
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
      '2026-10-19',
    ];

    // A primeira requisicao pode renovar a sessao, e a renovacao e uma
    // escrita a mais que nao tem a ver com o tamanho do lote.
    await consultas(small.launch.id, week(small.workers, ['2026-10-20']));

    const one = await consultas(
      small.launch.id,
      week(small.workers, ['2026-10-13']),
    );
    const all = await consultas(large.launch.id, week(large.workers, dates));

    expect(all).toBe(one);
  });
});
