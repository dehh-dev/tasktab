'use strict';

const fs = require('fs');
const {
  request,
  requestUpload,
  insertRow,
  insertRpaLaunch,
  insertRpaWorker,
  insertRpaPayment,
  updateColumnDirectly,
  uploadedFilePath,
  saveUpload,
  startApiInstance,
} = require('../../orchestrator');
const { QUESTIONS, photo, makeDriveZip } = require('../../fixtures/drive');
const { makeReceiptPdf } = require('../../fixtures/pdf');
const db = require('../../../src/config/database');

/**
 * Retencao do RPA (decisao de 2026-11-01): um mes depois de encerrado, o
 * lancamento perde os documentos, os recibos e os dados pessoais da equipe.
 * Ficam nome, CPF e os valores dos RPAs.
 */

// O que a pessoa traz alem de nome e CPF; tudo isso sai na retencao.
const PERSONAL = {
  email: 'retida@exemplo.com',
  rg: '123456789',
  birth_date: '1990-05-17',
  birth_place: 'Avaré-SP',
  pis: '12056234899',
  address: 'Rua Sintetica, 100',
  district: 'Centro',
  city: 'Avaré-SP',
  cep: '18700000',
  mother_name: 'Mae Sintetica',
  father_name: 'Pai Sintetico',
  bank_code: '341',
  bank_name: 'Itau Unibanco',
  agency: '0168',
  account: '62311-4',
  account_type: 'checking',
  pix_key_type: 'cpf',
  pix_key: '52998224725',
};

const daysAgo = (days) => new Date(Date.now() - days * 86400000);

async function launchRow(id) {
  const { rows } = await db.query(
    'SELECT status, closed_at, purged_at FROM rpa_launches WHERE id = $1',
    [id],
  );
  return rows[0];
}

async function workerRow(id) {
  const { rows } = await db.query('SELECT * FROM rpa_workers WHERE id = $1', [
    id,
  ]);
  return rows[0];
}

async function fileRows(launchId) {
  const { rows } = await db.query(
    `SELECT file_path FROM rpa_files WHERE launch_id = $1
     UNION ALL
     SELECT file_path FROM rpa_receipt_batches WHERE launch_id = $1`,
    [launchId],
  );
  return rows.map((row) => row.file_path);
}

/** Lancamento com uma pessoa completa, um RPA, um documento e um recibo. */
async function arrangeLaunch(name) {
  const launch = await insertRpaLaunch();
  const worker = await insertRpaWorker({
    launch_id: launch.id,
    name,
    ...PERSONAL,
    issues: JSON.stringify([
      { field: 'address', code: 'no_number', source: 'check' },
    ]),
  });
  const payment = await insertRpaPayment({ worker_id: worker.id });

  const uploaded = await requestUpload(
    `/api/rpa/launches/${launch.id}/documents`,
    [
      {
        buffer: await makeDriveZip([
          {
            question: QUESTIONS.ctpsFront,
            name: `IMG_${launch.id} - ${name}.jpg`,
            data: await photo(launch.id),
          },
        ]),
        filename: 'respostas.zip',
      },
    ],
    { field: 'file' },
  );
  expect(uploaded.status).toBe(200);

  const scanned = saveUpload(
    await makeReceiptPdf({ total: `${launch.id},00` }),
  );
  await insertRow('rpa_receipt_batches', {
    launch_id: launch.id,
    payment_number: 1,
    page_count: 1,
    status: 'done',
    result: JSON.stringify({ matched: [{ name_read: name }] }),
    ...scanned,
  });

  return { launch, worker, payment };
}

async function closeAt(launchId, when) {
  const closed = await request('PATCH', `/api/rpa/launches/${launchId}`, {
    status: 'closed',
  });
  expect(closed.status).toBe(200);
  await updateColumnDirectly('rpa_launches', launchId, 'closed_at', when);
}

describe('PATCH /api/rpa/launches/:id: o prazo da retencao', () => {
  it('encerrar marca o dia em que os dados saem; reabrir desmarca', async () => {
    const launch = await insertRpaLaunch();

    const closed = await request('PATCH', `/api/rpa/launches/${launch.id}`, {
      status: 'closed',
    });
    const {
      rows: [expected],
    } = await db.query(
      `SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')
                + interval '1 month')::date AS day`,
    );
    const reopened = await request('PATCH', `/api/rpa/launches/${launch.id}`, {
      status: 'open',
    });

    expect(closed.body.data).toMatchObject({
      status: 'closed',
      purge_on: expected.day,
      purged_at: null,
    });
    expect(closed.body.data.closed_at).not.toBeNull();
    expect(reopened.body.data).toMatchObject({
      status: 'open',
      closed_at: null,
      purge_on: null,
    });
  });
});

describe('a varredura da retencao, na subida da API', () => {
  let instance = null;

  afterEach(async () => {
    await instance?.stop();
    instance = null;
  });

  it('apaga dados pessoais e arquivos do encerrado ha mais de um mes, e so dele', async () => {
    const expired = await arrangeLaunch('Pessoa Sintetica Vencida');
    const recent = await arrangeLaunch('Pessoa Sintetica Recente');
    const open = await arrangeLaunch('Pessoa Sintetica Aberta');
    await closeAt(expired.launch.id, daysAgo(32));
    await closeAt(recent.launch.id, daysAgo(20));
    const expiredFiles = await fileRows(expired.launch.id);
    expect(expiredFiles).toHaveLength(2);

    instance = await startApiInstance({ LOG_LEVEL: 'info' });
    const deadline = Date.now() + 10000;
    while (
      !(await launchRow(expired.launch.id)).purged_at &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const worker = await workerRow(expired.worker.id);
    expect(await launchRow(expired.launch.id)).toMatchObject({
      status: 'closed',
      purged_at: expect.any(Date),
    });
    expect(
      Object.fromEntries(
        Object.keys(PERSONAL).map((column) => [column, worker[column]]),
      ),
    ).toEqual(
      Object.fromEntries(Object.keys(PERSONAL).map((column) => [column, null])),
    );
    expect(worker).toMatchObject({
      name: 'Pessoa Sintetica Vencida',
      cpf: '52998224725',
      issues: [],
    });
    expect(await fileRows(expired.launch.id)).toEqual([]);
    expect(
      expiredFiles.filter((file) => fs.existsSync(uploadedFilePath(file))),
    ).toEqual([]);

    // O RPA continua: e o historico do que foi pedido ao financeiro.
    const { rows: payments } = await db.query(
      'SELECT net_cents, code FROM rpa_payments WHERE worker_id = $1',
      [expired.worker.id],
    );
    expect(payments).toEqual([
      { net_cents: expired.payment.net_cents, code: expired.payment.code },
    ]);

    // O encerrado ha 20 dias e o aberto ficam como estavam.
    for (const kept of [recent, open]) {
      expect((await launchRow(kept.launch.id)).purged_at).toBeNull();
      expect(await workerRow(kept.worker.id)).toMatchObject(PERSONAL);
      expect(await fileRows(kept.launch.id)).toHaveLength(2);
    }

    // O log so tem contagens.
    const output = instance.output();
    const line = output
      .trim()
      .split('\n')
      .map((entry) => JSON.parse(entry))
      .find(
        (entry) =>
          entry.msg ===
          'retencao do RPA: dados pessoais do lancamento apagados',
      );
    expect(line).toMatchObject({
      launch_id: expired.launch.id,
      files: 2,
      workers: 1,
    });
    expect(
      ['Vencida', '52998224725', 'IMG_'].filter((value) =>
        output.includes(value),
      ),
    ).toEqual([]);
  }, 70000);
});

describe('lancamento com os dados apagados', () => {
  async function arrangePurged() {
    const payment = await insertRpaPayment();
    const {
      rows: [{ launch_id: launchId }],
    } = await db.query('SELECT launch_id FROM rpa_workers WHERE id = $1', [
      payment.worker_id,
    ]);
    await updateColumnDirectly('rpa_launches', launchId, 'status', 'closed');
    await updateColumnDirectly(
      'rpa_launches',
      launchId,
      'purged_at',
      new Date(),
    );
    return { launchId, payment };
  }

  it('nao reabre, e o PDF e o .zip dos RPAs nao saem mais', async () => {
    const { launchId, payment } = await arrangePurged();

    const shown = await request('GET', `/api/rpa/launches/${launchId}`);
    const reopen = await request('PATCH', `/api/rpa/launches/${launchId}`, {
      status: 'open',
    });
    const pdf = await request('GET', `/api/rpa/payments/${payment.id}/rpa.pdf`);
    const zip = await request(
      'GET',
      `/api/rpa/launches/${launchId}/rpas.zip?payment=1`,
    );

    expect(shown.status).toBe(200);
    expect(shown.body.data.purged_at).not.toBeNull();
    expect([reopen.status, pdf.status, zip.status]).toEqual([409, 409, 409]);
    for (const response of [reopen, pdf, zip]) {
      expect(response.body).toMatchObject({
        name: 'ConflictError',
        message: expect.stringMatching(
          new RegExp(
            `^O lancamento ${launchId} teve os dados pessoais apagados pela retencao em \\d{2}/\\d{2}/\\d{4}\\.$`,
          ),
        ),
      });
    }
  });
});
