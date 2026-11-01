'use strict';

const JSZip = require('jszip');
const { PDFDocument, PDFName, PDFDict } = require('pdf-lib');
const {
  request,
  requestUpload,
  requestBinary,
  insertRpaLaunch,
  insertRpaWorker,
  insertRpaPayment,
  waitForQueue,
} = require('../../orchestrator');
const { syntheticCpf } = require('../../fixtures/forms');
const { makeScannedRpaReceipts } = require('../../fixtures/rpa-receipts');
const { makePdf } = require('../../fixtures/pdf');

/**
 * Os recibos assinados (issue 42): o PDF escaneado que o financeiro devolve
 * sai separado por pessoa, e o pagamento vira pago. A leitura e por OCR, na
 * fila da API: cada teste espera a fila antes de conferir.
 */
const PEOPLE = [
  {
    number: 1,
    name: 'Maria da Conceição Silva',
    receipt: 'MARIA DA CONCEICAO SILVA',
  },
  { number: 2, name: 'João Araújo', receipt: 'JOAO ARAUJO' },
  { number: 3, name: 'Ana Paula Souza', receipt: 'ANA PAULA SOUZA' },
  { number: 4, name: 'Pedro Henrique Lima', receipt: 'PEDRO HENRIQUE LIMA' },
  { number: 5, name: 'Carla Mendes', receipt: 'CARLA MENDES' },
];

async function arrange() {
  const launch = await insertRpaLaunch({ city: 'Avaré', state: 'SP' });
  const people = [];

  for (const person of PEOPLE) {
    const worker = await insertRpaWorker({
      launch_id: launch.id,
      number: person.number,
      name: person.name,
      cpf: syntheticCpf(person.number * 11),
    });
    const payment = await insertRpaPayment({
      worker_id: worker.id,
      code: `1-815-${person.number}-102026`,
    });
    people.push({ ...person, worker, payment });
  }

  return { launch, people };
}

function receiptOf(person, overrides = {}) {
  return { name: person.receipt, cpf: person.worker.cpf, ...overrides };
}

async function send(launchId, pdf, query = '?payment=1') {
  const response = await requestUpload(
    `/api/rpa/launches/${launchId}/receipts${query}`,
    [{ buffer: pdf, filename: 'RPCI assinados.pdf' }],
    { field: 'file' },
  );
  await waitForQueue({ timeoutMs: 120000 });
  return response;
}

async function batchOf(response) {
  const batch = await request(
    'GET',
    `/api/rpa/receipt-batches/${response.body.data.id}`,
  );
  return batch.body.data;
}

async function receiptsZip(launchId) {
  const response = await requestBinary(
    'GET',
    `/api/rpa/launches/${launchId}/receipts.zip?payment=1`,
  );
  const zip = await JSZip.loadAsync(response.buffer);
  const files = {};
  for (const name of Object.keys(zip.files).sort()) {
    files[name] = await zip.file(name).async('nodebuffer');
  }
  return files;
}

/** Os bytes da imagem da pagina, como estao no PDF (sem decodificar). */
async function imageStream(pdf, pageIndex) {
  const document = await PDFDocument.load(pdf, { updateMetadata: false });
  const resources = document.getPage(pageIndex).node.Resources();
  const xobjects = resources.lookup(PDFName.of('XObject'), PDFDict);
  const [ref] = xobjects.values();
  return Buffer.from(document.context.lookup(ref).getContents());
}

describe('POST /api/rpa/launches/:id/receipts', () => {
  it('separa os recibos de 5 pessoas pelo CPF, cada um com o nome do cadastro, e marca pago', async () => {
    const { launch, people } = await arrange();
    // Fora de ordem, um com o nome errado, um com um centavo a mais, um sem
    // CPF (casa pelo nome) e uma pagina de quem nao esta no pagamento.
    const pdf = await makeScannedRpaReceipts([
      receiptOf(people[2]),
      receiptOf(people[0], { name: 'MARIA DA CONSEICAO SILV' }),
      receiptOf(people[4], { net: '650,01' }),
      { name: 'PESSOA DE FORA', cpf: syntheticCpf(999) },
      receiptOf(people[1], { cpf: null }),
      receiptOf(people[3]),
    ]);

    const response = await send(launch.id, pdf);

    expect(response.status).toBe(202);
    expect(response.headers.get('location')).toBe(
      `/api/rpa/receipt-batches/${response.body.data.id}`,
    );
    expect(response.body.data).toMatchObject({
      status: 'pending',
      page_count: 6,
    });

    const batch = await batchOf(response);
    expect(batch.status).toBe('done');

    const matched = Object.fromEntries(
      batch.result.matched.map((entry) => [
        entry.page,
        [entry.worker_number, entry.by],
      ]),
    );
    expect(matched).toEqual({
      1: [3, 'cpf'],
      2: [1, 'cpf'],
      3: [5, 'cpf'],
      5: [2, 'name'],
      6: [4, 'cpf'],
    });
    expect(batch.result.missing).toEqual([]);
    expect(batch.result.unmatched_pages).toEqual([
      { page: 4, reason: 'CPF de quem nao esta neste pagamento' },
    ]);

    // O nome errado casou pelo CPF e e apontado, nao corrigido.
    expect(batch.result.name_differences).toEqual([
      expect.objectContaining({
        page: 2,
        worker_number: 1,
        name_read: 'MARIA DA CONSEICAO SILV',
      }),
    ]);
    // O centavo a mais tambem: apontado, e o RPA continua de R$ 650,00.
    expect(batch.result.value_differences).toEqual([
      expect.objectContaining({
        page: 3,
        worker_number: 5,
        net_read_cents: 65001,
        net_cents: 65000,
      }),
    ]);

    const zip = await receiptsZip(launch.id);
    expect(Object.keys(zip)).toEqual([
      'RECIBO ANA PAULA SOUZA.pdf',
      'RECIBO CARLA MENDES.pdf',
      'RECIBO JOÃO ARAÚJO.pdf',
      'RECIBO MARIA DA CONCEIÇÃO SILVA.pdf',
      'RECIBO PEDRO HENRIQUE LIMA.pdf',
    ]);

    // A pagina separada leva a mesma imagem, byte a byte: nada recomprimido.
    const maria = zip['RECIBO MARIA DA CONCEIÇÃO SILVA.pdf'];
    expect((await PDFDocument.load(maria)).getPageCount()).toBe(1);
    expect(
      Buffer.compare(await imageStream(maria, 0), await imageStream(pdf, 1)),
    ).toBe(0);

    const payment = await request(
      'GET',
      `/api/rpa/payments/${people[4].payment.id}`,
    );
    expect(payment.body.data).toMatchObject({
      status: 'paid',
      net_cents: 65000,
    });
  }, 120000);

  it('o recibo que faltou e apontado, e o pagamento dele continua emitido', async () => {
    const { launch, people } = await arrange();
    const pdf = await makeScannedRpaReceipts(
      people.slice(0, 4).map((person) => receiptOf(person)),
    );

    const batch = await batchOf(await send(launch.id, pdf));

    expect(batch.result.missing).toEqual([
      expect.objectContaining({ worker_number: 5, code: '1-815-5-102026' }),
    ]);
    const missing = await request(
      'GET',
      `/api/rpa/payments/${people[4].payment.id}`,
    );
    expect(missing.body.data.status).toBe('issued');
  }, 120000);

  it('reenviar o mesmo PDF nao duplica os recibos', async () => {
    const { launch, people } = await arrange();
    const pdf = await makeScannedRpaReceipts([receiptOf(people[0])]);

    await send(launch.id, pdf);
    await send(launch.id, pdf);

    expect(Object.keys(await receiptsZip(launch.id))).toEqual([
      'RECIBO MARIA DA CONCEIÇÃO SILVA.pdf',
    ]);
  }, 120000);

  it('o que nao e PDF, pagamento que nao existe e lancamento encerrado nao passam', async () => {
    const { launch } = await arrange();
    const closed = await insertRpaLaunch({ status: 'closed' });
    const pdf = await makePdf();

    const notPdf = await send(launch.id, Buffer.from('nao e pdf'));
    const noPayment = await send(launch.id, pdf, '?payment=3');
    const noQuery = await send(launch.id, pdf, '');
    const refused = await send(closed.id, pdf);

    expect(notPdf.status).toBe(422);
    expect(notPdf.body.details).toEqual([
      { field: 'file', message: 'o arquivo nao e um PDF' },
    ]);
    expect(noPayment.body.details).toEqual([
      { field: 'payment', message: 'nenhum RPA com este numero' },
    ]);
    expect(noQuery.status).toBe(422);
    expect(refused.status).toBe(409);
  });
});
