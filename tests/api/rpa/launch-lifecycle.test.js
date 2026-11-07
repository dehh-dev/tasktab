'use strict';

const JSZip = require('jszip');
const { PDFDocument } = require('pdf-lib');
const {
  request,
  requestUpload,
  requestBinary,
  waitForQueue,
} = require('../../orchestrator');
const {
  formResponse,
  makeFormXlsx,
  syntheticCpf,
} = require('../../fixtures/forms');
const { QUESTIONS, photo, makeDriveZip } = require('../../fixtures/drive');
const { makePdf } = require('../../fixtures/pdf');
const { extractPdfText } = require('../../helpers/pdf-text');

/**
 * O modulo RPA inteiro, so pela API publica, com uma equipe sorteada: da
 * empresa ao lancamento encerrado. Os outros arquivos provam cada parte com
 * dados escolhidos; este prova que as partes se encaixam.
 *
 * O cenario pedido por quem paga: trabalho de 11/11 a 22/11/2026, todos os
 * dias, com folga no dia 15 (domingo e Proclamacao da Republica) e 2 horas
 * extras no dia do lancamento do empreendimento (terca, 17/11) e no dia
 * seguinte. 20/11 (Consciencia Negra) e feriado nacional. O pagamento segue o
 * processo: o treinamento (11 a 16) no dia do lancamento, e a semana do
 * lancamento (17 a 22) na segunda seguinte.
 *
 * Nomes, CPFs, funcoes e diarias saem de um sorteio com semente fixa: a falha
 * se repete. `RPA_SEED=<numero>` sorteia outra equipe. As diarias ficam entre
 * R$ 100 e R$ 300, onde o mes inteiro fica abaixo dos R$ 5.000 que a reducao
 * de 2026 isenta de IRRF; assim o bruto se confere so com o INSS.
 */
const SEED = Number(process.env.RPA_SEED) || 20261111;

/** mulberry32: o mesmo `seed` da sempre a mesma sequencia. */
function sequence(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = [
  'Ana',
  'João',
  'Maria',
  'José',
  'Antônio',
  'Francisca',
  'Luíza',
  'Paulo',
  'Márcia',
  'Raimundo',
  'Cláudia',
  'Sebastião',
];
const MIDDLE_NAMES = ['da Conceição', 'de Souza', 'dos Santos', 'Aparecida'];
const LAST_NAMES = [
  'Silva',
  'Araújo',
  'Gonçalves',
  'Pereira',
  'Brandão',
  'Simões',
  'Assunção',
  'Lima',
  'Ribeiro',
  'Magalhães',
];

// A funcao do formulario vem escrita como a pessoa escreveu; a diaria casa
// sem acento e sem caixa.
const ROLES = [
  { role: 'Recepcionista', typed: 'recepcionista' },
  { role: 'Assistente Administrativo', typed: 'ASSISTENTE ADMINISTRATIVO' },
  { role: 'Coordenadora de Equipe', typed: 'Coordenadora de equipe' },
];

const WEEK = [1, 2, 3, 4, 5, 6, 7];
const EIGHT_HOURS = {
  start_time: '08:00',
  lunch_out: '12:00',
  lunch_in: '13:00',
  end_time: '17:00',
};

const fold = (text) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

const formatCpf = (cpf) =>
  cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

/** `R$ 1.234,56`, como o PDF do RPA e o recibo do RH escrevem. */
function brl(cents) {
  const [reais, centavos] = (cents / 100).toFixed(2).split('.');
  return `${reais.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${centavos}`;
}

function draw(random) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  const roles = ROLES.map((entry, index) => ({
    ...entry,
    // De R$ 100,00 a R$ 300,00, de 50 em 50 centavos. A primeira termina
    // sempre em 50: as 8,75 diarias da semana do lancamento caem em meio
    // centavo, e o arredondamento do total entra em toda semente.
    daily_cents:
      index === 0
        ? 10050 + 100 * Math.floor(random() * 200)
        : 10000 + 50 * Math.floor(random() * 401),
  }));
  const size = 4 + Math.floor(random() * 4);
  const people = [];
  const keys = new Set();
  const cpfs = new Set();

  while (people.length < size) {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const cpf = syntheticCpf(1 + Math.floor(random() * 99999998));
    // Primeiro e ultimo nome repetidos dariam a mesma pasta no .zip dos
    // documentos, com o numero da pessoa no fim (ha teste disso); aqui cada
    // um tem a sua.
    if (keys.has(`${first} ${last}`) || cpfs.has(cpf)) continue;
    keys.add(`${first} ${last}`);
    cpfs.add(cpf);

    const middle = random() < 0.5 ? ` ${pick(MIDDLE_NAMES)}` : '';
    people.push({
      name: `${first}${middle} ${last}`,
      // A conta Google com o nome completo: so ele liga o documento.
      account: `${first}${middle} ${last}`,
      folder: `${first} ${last}`.toUpperCase(),
      cpf,
      // As tres funcoes aparecem em toda semente; dali em diante, sorteio.
      rate: people.length < roles.length ? roles[people.length] : pick(roles),
    });
  }

  return { roles, people };
}

/**
 * O bruto conferido por fora do codigo: o menor bruto cujo liquido, com o
 * INSS de 11% cortado no centavo, da o valor do RPA. Sem IRRF nesta faixa.
 */
function grossFor(netCents) {
  let gross = netCents;
  while (gross - Math.floor((gross * 11) / 100) < netCents) gross += 1;
  return gross;
}

/** O RPCI do RH (Senior), com camada de texto, como o recibo real. */
function rhReceipt(person, netCents, date) {
  return makePdf({
    size: [596, 842],
    lines: [
      'Recibo de Pagamento a Contribuinte Individual - RPCI',
      'NOME OU RAZAO SOCIAL DA EMPRESA',
      'EMPRESA SORTEADA SPE LTDA',
      `Recebi da empresa acima identificada a importancia de R$ ${brl(netCents)} -- ( reais )`,
      `CPF: ${formatCpf(person.cpf)}`,
      'LIQUIDO:',
      `Avare - SP, ${date}`,
      'NOME COMPLETO',
      fold(person.name),
    ],
  });
}

async function joined(pdfs) {
  const merged = await PDFDocument.create();
  for (const pdf of pdfs) {
    const source = await PDFDocument.load(pdf);
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return Buffer.from(await merged.save());
}

async function zipNames(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  return Object.keys(zip.files)
    .filter((name) => !zip.files[name].dir)
    .sort();
}

async function sendReceipts(launchId, payment, files) {
  const response = await requestUpload(
    `/api/rpa/launches/${launchId}/receipts?payment=${payment}`,
    files,
    { field: 'file' },
  );
  expect(response.status).toBe(202);
  await waitForQueue({ timeoutMs: 120000 });
  const batch = await request(
    'GET',
    `/api/rpa/receipt-batches/${response.body.data.id}`,
  );
  return batch.body.data;
}

describe(`RPA de ponta a ponta, com a equipe sorteada (RPA_SEED=${SEED})`, () => {
  it('de 11/11 a 22/11: folga no feriado, extras no lancamento, dois pagamentos, recibos e encerramento', async () => {
    const random = sequence(SEED);
    const { roles, people } = draw(random);
    const companyCode = 1000 + Math.floor(random() * 8999);
    const daily = (person) => person.rate.daily_cents;

    // 1. Empresa e lancamento, com o horario de todos os dias da semana.
    const company = await request('POST', '/api/rpa/companies', {
      code: companyCode,
      name: 'Empresa Sorteada SPE Ltda',
      cnpj: '26048802000165',
      city: 'Avaré',
      state: 'SP',
      service_type: 'Prestação de Serviços Administrativos',
      cost_center: '71401',
    });
    expect(company.status).toBe(201);

    const created = await request('POST', '/api/rpa/launches', {
      company_id: company.body.data.id,
      city: 'Avaré',
      state: 'SP',
      development: 'Residencial Sorteado',
      starts_on: '2026-11-11',
      ends_on: '2026-11-22',
      holidays: ['2026-11-15', '2026-11-20'],
      site: 'Residencial Sorteado',
      product: 'Lançamento',
      supply: 'Mão de obra',
      email_to: ['financeiro@exemplo.test'],
      email_cc: ['obra@exemplo.test'],
      first_payment_daily_only: true,
      schedule: WEEK.map((weekday) => ({ weekday, ...EIGHT_HOURS })),
      rates: roles.map(({ role, daily_cents }) => ({
        role,
        starts_on: '2026-11-01',
        ends_on: '2026-11-30',
        daily_cents,
      })),
    });
    expect(created.status).toBe(201);
    const launch = created.body.data;

    // 2. Equipe pelo .xlsx do formulario. O primeiro escreveu o endereco
    // sem numero: entra, com a pendencia escrita.
    const xlsx = await makeFormXlsx(
      people.map((person, index) =>
        formResponse(index + 1, {
          form_submitted_at: `05/11/2026 10:${String(index).padStart(2, '0')}:00`,
          name: person.name,
          role: person.rate.typed,
          starts_on: '11/11/2026',
          cpf: person.cpf,
          pix_key: person.cpf,
          ...(index === 0 ? { address: 'Rua das Flores' } : {}),
        }),
      ),
    );
    const imported = await requestUpload(
      `/api/rpa/launches/${launch.id}/import`,
      [{ buffer: xlsx, filename: 'Cadastro (respostas).xlsx' }],
      { field: 'file' },
    );
    expect(imported.status).toBe(200);
    expect(imported.body.data).toMatchObject({
      created: people.length,
      updated: 0,
      rejected: [],
      warnings: [],
    });

    const team = await request('GET', `/api/rpa/launches/${launch.id}/workers`);
    const byCpf = new Map(team.body.data.map((worker) => [worker.cpf, worker]));
    for (const person of people) {
      person.worker = byCpf.get(person.cpf);
      expect(person.worker).toBeDefined();
    }
    expect(
      people.map((person) =>
        person.worker.issues.map((issue) => `${issue.code}:${issue.field}`),
      ),
    ).toEqual(
      people.map((_, index) =>
        index === 0 ? ['address_without_number:address'] : [],
      ),
    );

    const fixed = await request(
      'PATCH',
      `/api/rpa/workers/${people[0].worker.id}`,
      { address: 'Rua das Flores, 45' },
    );
    expect(fixed.status).toBe(200);
    expect(fixed.body.data.issues).toEqual([]);

    // 3. Ponto: a folga do dia 15 e as duas horas extras dos dias 17 e 18.
    const saved = await request('PUT', `/api/rpa/launches/${launch.id}/days`, {
      days: people.flatMap(({ worker }) => [
        {
          worker_id: worker.id,
          date: '2026-11-15',
          quantity: 0,
          note: 'Folga',
        },
        ...['2026-11-17', '2026-11-18'].map((date) => ({
          worker_id: worker.id,
          date,
          ...EIGHT_HOURS,
          end_time: '19:00',
          note: '2h extras no lancamento',
        })),
      ]),
    });
    expect(saved.status).toBe(200);

    const grid = await request(
      'GET',
      `/api/rpa/launches/${launch.id}/days?from=2026-11-11&to=2026-11-22`,
    );
    expect(grid.status).toBe(200);
    // Em diarias: dia util e sabado valem 1; domingo e feriado, 2; o dia de
    // 10h leva 2h a 50%, 2 x 1,5 / 8 = 0,375 de diaria.
    const expectedDays = {
      '2026-11-11': ['weekday', 1],
      '2026-11-12': ['weekday', 1],
      '2026-11-13': ['weekday', 1],
      '2026-11-14': ['saturday', 1],
      '2026-11-15': ['holiday', 0],
      '2026-11-16': ['weekday', 1],
      '2026-11-17': ['weekday', 1.375],
      '2026-11-18': ['weekday', 1.375],
      '2026-11-19': ['weekday', 1],
      '2026-11-20': ['holiday', 2],
      '2026-11-21': ['saturday', 1],
      '2026-11-22': ['sunday', 2],
    };
    for (const person of people) {
      const row = grid.body.data.workers.find(
        (entry) => entry.id === person.worker.id,
      );
      const subcents = daily(person) * 1920;
      expect(
        Object.fromEntries(
          row.days.map((day) => [day.date, [day.kind, day.value_subcents]]),
        ),
      ).toEqual(
        Object.fromEntries(
          Object.entries(expectedDays).map(([date, [kind, days]]) => [
            date,
            [kind, days * subcents],
          ]),
        ),
      );
      expect(row.totals).toMatchObject({
        quantity: 11,
        value_subcents: 13.75 * subcents,
        days_without_rate: 0,
      });
    }

    // 4. 1o pagamento: o treinamento, no dia do lancamento. A previa nao
    // grava; a emissao faz a mesma conta.
    const firstPeriod = {
      period_start: '2026-11-11',
      period_end: '2026-11-16',
      payment_date: '2026-11-17',
    };
    const preview = await request(
      'POST',
      `/api/rpa/launches/${launch.id}/payments?preview=true`,
      firstPeriod,
    );
    expect(preview.status).toBe(200);
    const nothingYet = await request(
      'GET',
      `/api/rpa/launches/${launch.id}/payments`,
    );
    expect(nothingYet.body.data).toEqual([]);

    const first = await request(
      'POST',
      `/api/rpa/launches/${launch.id}/payments`,
      firstPeriod,
    );
    expect(first.status).toBe(201);

    const expectFirst = (person) => {
      const value = 5 * daily(person);
      const gross = grossFor(value);
      return expect.objectContaining({
        worker_id: person.worker.id,
        number: 1,
        code: `1-${companyCode}-${person.worker.number}-112026`,
        value_cents: value,
        net_cents: value,
        gross_cents: gross,
        inss_cents: gross - value,
        irrf_cents: 0,
        deferred_extra_subcents: 0,
      });
    };
    const firstByWorker = (payments) =>
      people.map((person) =>
        payments.find((payment) => payment.worker_id === person.worker.id),
      );
    expect(firstByWorker(first.body.data.payments)).toEqual(
      people.map(expectFirst),
    );
    expect(firstByWorker(preview.body.data.payments)).toEqual(
      people.map(expectFirst),
    );

    // 5. 2o pagamento: a semana do lancamento, com as extras e os dois dias
    // dobrados. 8,75 diarias, arredondadas uma vez so, meio para cima.
    const second = await request(
      'POST',
      `/api/rpa/launches/${launch.id}/payments`,
      {
        period_start: '2026-11-17',
        period_end: '2026-11-22',
        payment_date: '2026-11-23',
      },
    );
    expect(second.status).toBe(201);
    expect(firstByWorker(second.body.data.payments)).toEqual(
      people.map((person) => {
        const value = Math.floor((875 * daily(person) + 50) / 100);
        const gross = grossFor(value);
        return expect.objectContaining({
          number: 2,
          code: `2-${companyCode}-${person.worker.number}-112026`,
          value_cents: value,
          net_cents: value,
          gross_cents: gross,
          inss_cents: gross - value,
          irrf_cents: 0,
        });
      }),
    );
    for (const person of people) {
      person.payments = [first, second].map((response) =>
        response.body.data.payments.find(
          (payment) => payment.worker_id === person.worker.id,
        ),
      );
    }

    // 6. Emissao: o e-mail de cada pagamento, o PDF de uma pessoa e o .zip.
    const subject = `SOLICITAÇÃO DE EMISSÃO RPA - LANÇAMENTO AVARÉ/SP - EMP. ${companyCode}`;
    const emails = await Promise.all(
      [1, 2].map((payment) =>
        request(
          'GET',
          `/api/rpa/launches/${launch.id}/email?payment=${payment}`,
        ),
      ),
    );
    expect(emails[0].body.data).toMatchObject({
      reply: false,
      subject,
      count: people.length,
      to: ['financeiro@exemplo.test'],
      cc: ['obra@exemplo.test'],
    });
    expect(emails[0].body.data.text).toContain(
      'Data para pagamento: 17/11/2026',
    );
    expect(emails[0].body.data.text).toContain(
      `Seguem em anexo ${people.length} RPAs.`,
    );
    expect(emails[1].body.data).toMatchObject({ reply: true, subject });
    expect(emails[1].body.data.text).toContain(
      'Solicito emissão de RPA do 2º pagamento',
    );
    expect(emails[1].body.data.text).toContain(
      'Data para pagamento: 23/11/2026',
    );

    const sample = people[Math.floor(random() * people.length)];
    const [, sampleSecond] = sample.payments;
    const pdf = await requestBinary(
      'GET',
      `/api/rpa/payments/${sampleSecond.id}/rpa.pdf`,
    );
    expect(pdf.status).toBe(200);
    const [pdfText] = extractPdfText(pdf.buffer);
    for (const field of [
      sampleSecond.code,
      sample.name.toUpperCase(),
      formatCpf(sample.cpf),
      '17/11/2026 até 22/11/2026',
      '23/11/2026',
      `R$ ${brl(sampleSecond.gross_cents)}`,
      `R$ ${brl(sampleSecond.inss_cents)}`,
      `R$ ${brl(sampleSecond.net_cents)}`,
    ]) {
      expect(pdfText).toContain(field);
    }

    const rpas = await requestBinary(
      'GET',
      `/api/rpa/launches/${launch.id}/rpas.zip?payment=2`,
    );
    expect(rpas.status).toBe(200);
    expect(await zipNames(rpas.buffer)).toHaveLength(people.length);

    // 7. Documentos do Drive: cada arquivo vai para a pasta da pessoa.
    let seed = 0;
    const driveFiles = [];
    for (const person of people) {
      for (const question of ['ctpsFront', 'ctpsBack', 'idFront', 'address']) {
        seed += 1;
        driveFiles.push({
          question: QUESTIONS[question],
          name: `IMG_${String(seed).padStart(4, '0')} - ${person.account}.jpg`,
          data: await photo(SEED + seed),
        });
      }
    }
    const documents = await requestUpload(
      `/api/rpa/launches/${launch.id}/documents`,
      [
        {
          buffer: await makeDriveZip(driveFiles),
          filename: 'Cadastro (File responses).zip',
        },
      ],
      { field: 'file' },
    );
    expect(documents.status).toBe(200);
    expect(documents.body.data).toMatchObject({
      received: driveFiles.length,
      created: driveFiles.length,
      rejected: [],
    });
    expect(
      documents.body.data.documents.filter((file) => file.worker_id === null),
    ).toEqual([]);

    const documentsZip = await requestBinary(
      'GET',
      `/api/rpa/launches/${launch.id}/documents.zip`,
    );
    expect(await zipNames(documentsZip.buffer)).toEqual(
      people
        .flatMap((person) =>
          ['CE', 'CTPS FRENTE', 'CTPS VERSO', 'RG-CNH FRENTE'].map(
            (file) => `${person.folder}/${file}.jpg`,
          ),
        )
        .sort(),
    );

    // 8. Recibos assinados: o 1o, um PDF por pessoa; o 2o, um PDF so com
    // todas as paginas. Casados pelo CPF, os pagamentos viram pagos.
    const firstReceipts = await sendReceipts(
      launch.id,
      1,
      await Promise.all(
        people.map(async (person, index) => ({
          buffer: await rhReceipt(
            person,
            person.payments[0].net_cents,
            '17/11/2026',
          ),
          filename: `RECIBO ${index + 1}.pdf`,
        })),
      ),
    );
    const secondReceipts = await sendReceipts(launch.id, 2, [
      {
        buffer: await joined(
          await Promise.all(
            people.map((person) =>
              rhReceipt(person, person.payments[1].net_cents, '23/11/2026'),
            ),
          ),
        ),
        filename: 'RPCI assinados.pdf',
      },
    ]);
    for (const batch of [firstReceipts, secondReceipts]) {
      expect(batch.status).toBe('done');
      expect(batch.result.matched.map((entry) => entry.by)).toEqual(
        people.map(() => 'cpf'),
      );
      expect(batch.result.missing).toEqual([]);
      expect(batch.result.unmatched_pages).toEqual([]);
      expect(batch.result.name_differences).toEqual([]);
      expect(batch.result.value_differences).toEqual([]);
    }

    const payments = await request(
      'GET',
      `/api/rpa/launches/${launch.id}/payments`,
    );
    expect(payments.body.data.map((payment) => payment.status)).toEqual(
      people.flatMap(() => ['paid', 'paid']),
    );

    // 9. O Inicio sem pendencia: tudo pago, ninguem sem RPA, nenhum saldo.
    const summary = await request('GET', '/api/rpa/summary');
    expect(summary.body.data).toEqual({
      open_launches: 1,
      next_payment: null,
      awaiting_receipt: 0,
      without_payment: 0,
      pending_balance: {
        launches: 0,
        to_pay: { people: 0, cents: 0 },
        to_deduct: { people: 0, cents: 0 },
      },
    });
    const balances = await request(
      'GET',
      `/api/rpa/launches/${launch.id}/balances`,
    );
    expect(balances.body.data).toEqual([]);

    // 10. Encerrado, o lancamento fica so leitura, com a data da retencao.
    const closed = await request('PATCH', `/api/rpa/launches/${launch.id}`, {
      status: 'closed',
    });
    expect(closed.status).toBe(200);
    expect(closed.body.data).toMatchObject({ status: 'closed' });
    expect(closed.body.data.purge_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const locked = await request('PUT', `/api/rpa/launches/${launch.id}/days`, {
      days: [
        { worker_id: people[0].worker.id, date: '2026-11-19', quantity: 0 },
      ],
    });
    expect(locked.status).toBe(409);
  }, 180000);
});
