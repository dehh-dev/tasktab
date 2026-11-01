'use strict';

const fs = require('fs');
const JSZip = require('jszip');
const { test, expect } = require('@playwright/test');
const { openSection, createUser, deleteUser } = require('./helpers');
const { formResponse, makeFormXlsx } = require('../tests/fixtures/forms');
const { QUESTIONS, photo, makeDriveZip } = require('../tests/fixtures/drive');
const { makeScannedRpaReceipts } = require('../tests/fixtures/rpa-receipts');

/**
 * O modulo RPA pela tela (issue 43), do .xlsx sintetico do formulario ao .zip
 * dos RPAs. O E2E nao trunca o banco entre execucoes, e lancamento com RPA
 * nao se apaga: empresa e empreendimento levam um sufixo unico por execucao.
 *
 * A empresa entra pela API (arranjo); o resto e a tela.
 */
const RUN = `${Date.now()}`.slice(-6);
const COMPANY_CODE = 50000 + (Number(RUN) % 40000);
const DEVELOPMENT = `Residencial E2E ${RUN}`;

async function arrangeCompany(request, code = COMPANY_CODE) {
  const response = await request.post('/api/rpa/companies', {
    data: {
      code,
      name: 'Empresa Sintetica do E2E',
      cnpj: '26048802000165',
      city: 'Avaré',
      state: 'SP',
      service_type: 'Prestação de Serviços Administrativos',
      cost_center: '71401',
    },
  });
  expect(response.ok()).toBe(true);
}

test('do .xlsx do formulario ao .zip dos RPAs, pela tela', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  await arrangeCompany(request);

  await page.goto('/');
  await openSection(page, 'RPA de Lancamentos');

  // Lancamento: empresa, periodo e a diaria; o horario padrao ja vem de
  // segunda a sexta, das 8h as 17h.
  await page.getByRole('button', { name: 'Novo lancamento' }).click();
  const form = page.locator('form.form');
  await form
    .getByLabel('Empresa')
    .selectOption({ label: `${COMPANY_CODE} - Empresa Sintetica do E2E` });
  await form.getByLabel('Empreendimento').fill(DEVELOPMENT);
  await form.getByLabel('Cidade').fill('Avaré');
  await form.getByLabel('UF').fill('SP');
  await form.getByLabel('Inicio', { exact: true }).fill('2026-10-13');
  await form.getByLabel('Fim', { exact: true }).fill('2026-11-30');
  await form.getByLabel('Funcao da diaria 1').fill('Assistente Administrativo');
  await form.getByLabel('Valor da diaria 1').fill('130,00');
  await form.getByRole('button', { name: 'Criar lancamento' }).click();

  await expect(
    page.getByRole('heading', { name: `${DEVELOPMENT} — Avaré/SP` }),
  ).toBeVisible();

  // Equipe: a planilha das respostas, com um CPF que nao fecha o verificador.
  const xlsx = await makeFormXlsx([
    formResponse(1),
    formResponse(2),
    formResponse(3, { cpf: '11111111111' }),
  ]);
  await page
    .getByLabel(/Arraste o \.xlsx ou \.csv das respostas/)
    .setInputFiles({
      name: 'Cadastro AVARE (respostas).xlsx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: xlsx,
    });

  await expect(page.getByText('Importacao: 3 nova(s)')).toBeVisible();
  await expect(page.getByText('3 pessoas, 1 com pendencia')).toBeVisible();
  // A pendencia esta escrita, nao so pintada.
  await expect(
    page
      .getByRole('list', { name: 'Pendencias de Pessoa Sintetica Numero 3' })
      .getByText(/Pendencia: .*CPF/),
  ).toBeVisible();

  // Ponto: a grade vem preenchida; muda a saida de um dia.
  await page.getByRole('button', { name: 'Ponto', exact: true }).click();
  const grid = page.getByRole('table', { name: /Ponto de 13\/10\/2026/ });
  await expect(grid.getByText('Folga').first()).toBeVisible();
  await grid
    .getByRole('button', {
      name: 'Pessoa Sintetica Numero 1, 14/10/2026: 08:00-17:00',
    })
    .click();
  const day = page.getByRole('form', { name: 'Editar dia' });
  await day.getByLabel('Saida', { exact: true }).fill('18:00');
  await day.getByRole('button', { name: 'Salvar dia' }).click();
  await expect(
    grid.getByRole('button', {
      name: 'Pessoa Sintetica Numero 1, 14/10/2026: 08:00-18:00',
    }),
  ).toContainText('alterado');

  // Pagamentos: previa e emissao da primeira semana.
  await page.getByRole('button', { name: 'Pagamentos', exact: true }).click();
  await page.getByLabel('Periodo: inicio').fill('2026-10-13');
  await page.getByLabel('Periodo: fim').fill('2026-10-19');
  await page.getByLabel('Data do pagamento').fill('2026-10-20');
  await page.getByRole('button', { name: 'Ver previa' }).click();

  const preview = page.getByRole('table', { name: 'Previa do pagamento' });
  await expect(preview.getByRole('row')).toHaveCount(4);
  // 5 diarias de R$ 130,00, so diarias no 1o pagamento.
  await expect(preview.getByText('R$ 650,00').first()).toBeVisible();

  await page.getByRole('button', { name: 'Emitir 3 RPAs' }).click();
  const issued = page.getByRole('table', { name: 'RPAs emitidos' });
  await expect(issued.getByText('Emitido', { exact: true })).toHaveCount(3);
  await expect(
    issued.getByText(`1-${COMPANY_CODE}-1-102026`, { exact: true }),
  ).toBeVisible();

  // Emissao: o e-mail montado e o .zip com um PDF por pessoa.
  await page.getByRole('button', { name: 'Emissao', exact: true }).click();
  await expect(page.getByLabel('Assunto', { exact: true })).toHaveValue(
    `SOLICITAÇÃO DE EMISSÃO RPA - LANÇAMENTO AVARÉ/SP - EMP. ${COMPANY_CODE}`,
  );

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'RPAs do 1º pagamento (.zip)' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('RPAs - 1ª Pagto - Avaré-SP.zip');

  const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
  const names = Object.keys(zip.files).sort();
  expect(names).toHaveLength(3);
  for (const name of names) {
    expect(name).toMatch(/^Solicitação - RPA - 1ª Pagto -.+\.pdf$/);
  }
});

/**
 * Lancamento, equipe e RPAs pela API (o assunto aqui sao as duas ultimas
 * abas): os documentos do Drive e os recibos assinados.
 */
async function arrangeIssuedLaunch(request) {
  const companies = await request.get('/api/rpa/companies?limit=100');
  const { data } = await companies.json();
  // Empresa propria: o codigo do RPA (no-empresa-pessoa-mmaaaa) repetiria o
  // do outro teste, que emite para a mesma pessoa 1 no mesmo mes.
  const company = data.find((entry) => entry.code === COMPANY_CODE + 1);
  const launch = await request.post('/api/rpa/launches', {
    data: {
      company_id: company.id,
      city: 'Avaré',
      state: 'SP',
      development: `${DEVELOPMENT} documentos`,
      starts_on: '2026-10-13',
      ends_on: '2026-11-30',
      schedule: [1, 2, 3, 4, 5].map((weekday) => ({
        weekday,
        start_time: '08:00',
        lunch_out: '12:00',
        lunch_in: '13:00',
        end_time: '17:00',
      })),
      rates: [
        {
          role: 'Assistente Administrativo',
          starts_on: '2026-10-13',
          ends_on: '2026-11-30',
          daily_cents: 13000,
        },
      ],
    },
  });
  const { data: created } = await launch.json();
  const imported = await request.post(
    `/api/rpa/launches/${created.id}/import`,
    {
      multipart: {
        file: {
          name: 'respostas.xlsx',
          mimeType: 'application/octet-stream',
          buffer: await makeFormXlsx([formResponse(1), formResponse(2)]),
        },
      },
    },
  );
  const { data: team } = await imported.json();
  const issued = await request.post(
    `/api/rpa/launches/${created.id}/payments`,
    {
      data: {
        period_start: '2026-10-13',
        period_end: '2026-10-19',
        payment_date: '2026-10-20',
      },
    },
  );
  expect(issued.status()).toBe(201);
  return { launch: created, team };
}

test('documentos do Drive e recibos assinados, pela tela', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  await arrangeCompany(request, COMPANY_CODE + 1);
  const { launch } = await arrangeIssuedLaunch(request);
  const workers = await (
    await request.get(`/api/rpa/launches/${launch.id}/workers`)
  ).json();
  const [first, second] = workers.data;

  await page.goto('/');
  await openSection(page, 'RPA de Lancamentos');
  await page
    .getByRole('button', { name: `${DEVELOPMENT} documentos — Avaré/SP` })
    .click();

  // Documentos: um casa pelo nome da conta, o outro fica sem pessoa.
  await page.getByRole('button', { name: 'Documentos', exact: true }).click();
  await page.getByLabel(/Arraste o \.zip da pasta de respostas/).setInputFiles({
    name: 'Cadastro (File responses).zip',
    mimeType: 'application/zip',
    buffer: await makeDriveZip([
      {
        question: QUESTIONS.ctpsFront,
        name: `IMG_1 - ${first.name}.jpg`,
        data: await photo(11),
      },
      {
        question: QUESTIONS.address,
        name: 'conta - Apelido Desconhecido.jpg',
        data: await photo(12),
      },
    ]),
  });
  await expect(page.getByText('2 documento(s), 1 sem pessoa')).toBeVisible();
  await expect(
    page.getByText('sem pessoa: conta "Apelido Desconhecido"'),
  ).toBeVisible();

  const orphan = page
    .getByRole('combobox', { name: /Pessoa do documento/ })
    .nth(1);
  await orphan.selectOption({ label: `${second.number}. ${second.name}` });
  await expect(page.getByText('2 documento(s), 0 sem pessoa')).toBeVisible();

  // Recibos: o PDF escaneado das duas pessoas, lido no servidor.
  await page.getByRole('button', { name: 'Recibos', exact: true }).click();
  await page.getByLabel(/Arraste o PDF dos recibos assinados/).setInputFiles({
    name: 'RPCI.pdf',
    mimeType: 'application/pdf',
    buffer: await makeScannedRpaReceipts([
      { name: second.name.toUpperCase(), cpf: second.cpf },
      { name: first.name.toUpperCase(), cpf: first.cpf },
    ]),
  });

  const matched = page.getByRole('list', { name: 'Recibos que casaram' });
  await expect(matched).toBeVisible({ timeout: 60000 });
  await expect(matched.getByText(/casou pelo CPF/)).toHaveCount(2);
  await expect(
    page.getByRole('link', { name: 'Recibos do 1º pagamento (.zip)' }),
  ).toBeVisible();
});

test.describe('quem alcanca o modulo', () => {
  let user = null;

  test.afterEach(async ({ request }) => {
    if (user) {
      await deleteUser(request, user.id);
      user = null;
    }
  });

  test('sem rpa:read o modulo nao aparece no menu nem no Inicio', async ({
    page,
    request,
  }) => {
    user = await createUser(request, { name: 'Pessoa sem RPA' });

    await page.context().clearCookies();
    await page.goto('/');
    const login = page.locator('form.form');
    await login.getByLabel('E-mail').fill(user.email);
    await login.getByLabel('Senha').fill(user.password);
    await login.getByRole('button', { name: 'Entrar' }).click();

    const nav = page.getByRole('navigation', { name: 'Principal' });
    await expect(nav.getByRole('button', { name: 'Tarefas' })).toBeVisible();
    await expect(
      nav.getByRole('button', { name: 'RPA de Lancamentos' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'RPA de Lancamentos' }),
    ).toHaveCount(0);
  });
});
