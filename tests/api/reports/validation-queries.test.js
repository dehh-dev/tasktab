'use strict';

const {
  request,
  insertReport,
  insertReceipt,
  insertMerchant,
  startApiInstance,
} = require('../../orchestrator');
const { startQueryCounter } = require('../../helpers/query-counter');

// A conferencia roda a cada abertura do detalhe do relatorio. Com uma consulta
// por comprovante na faixa do emitente e outra na suspeita de duplicata, eram
// 80 consultas num relatorio de 40 (issue 52).
describe('GET /api/reports/:id/validation, em consultas ao banco', () => {
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

  // Comprovantes confirmados do mesmo emitente, aos pares de mesma data e
  // valor: passam pelas duas regras que consultavam o banco por comprovante.
  async function relatorio(quantos) {
    const report = await insertReport();
    const merchant = await insertMerchant({
      cnpj: String(report.id).padStart(14, '0'),
    });

    for (let index = 0; index < quantos; index += 1) {
      await insertReceipt(report.id, {
        page_number: index + 1,
        status: 'confirmed',
        issued_at: '2026-06-19',
        amount_cents: 4000 + Math.floor(index / 2),
        category: 'alimentacao',
        merchant_id: merchant.id,
      });
    }

    return report.id;
  }

  async function consultas(reportId) {
    counter.reset();
    const response = await request(
      'GET',
      `/api/reports/${reportId}/validation`,
      undefined,
      { baseUrl: api.baseUrl },
    );

    expect(response.status).toBe(200);
    return counter.count();
  }

  it('nao cresce com o numero de comprovantes', async () => {
    const pequeno = await relatorio(2);
    const grande = await relatorio(20);

    // A primeira requisicao pode renovar a sessao, e a renovacao e uma
    // escrita a mais que nao tem a ver com o tamanho do relatorio.
    await consultas(pequeno);

    expect(await consultas(grande)).toBe(await consultas(pequeno));
  });
});
