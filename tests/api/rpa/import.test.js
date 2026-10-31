'use strict';

const JSZip = require('jszip');
const {
  request,
  requestUpload,
  insertRpaLaunch,
  insertRpaWorker,
  leftoverUploads,
} = require('../../orchestrator');
const {
  syntheticCpf,
  formResponse,
  makeFormXlsx,
  makeFormCsv,
} = require('../../fixtures/forms');
const { makePdf } = require('../../fixtures/pdf');

// O lancamento de Avare, com dados sinteticos: a cidade do lancamento e o
// que da a grafia com acento a quem digitou "avare sp".
const LAUNCH = {
  city: 'Avaré',
  state: 'SP',
  starts_on: '2026-10-13',
  ends_on: '2026-11-30',
};

function upload(
  launchId,
  buffer,
  filename = 'Cadastro AVARE (respostas).xlsx',
) {
  return requestUpload(
    `/api/rpa/launches/${launchId}/import`,
    [{ buffer, filename }],
    { field: 'file' },
  );
}

function issuesOf(body, number) {
  const worker = body.data.workers.find((entry) => entry.number === number);
  return worker.issues.map((entry) => `${entry.code}:${entry.field}`);
}

describe('POST /api/rpa/launches/:id/import', () => {
  it('importa a equipe do .xlsx com as pendencias de cada pessoa', async () => {
    const launch = await insertRpaLaunch(LAUNCH);
    const responses = [
      formResponse(1),
      // O caso real da planilha: CPF que comeca com zero virou numero.
      formResponse(2, {
        cpf: syntheticCpf(2, { leadingZero: true }),
        city: 'avare sp',
      }),
      formResponse(3, {
        address: 'Rua Sintetica Sem Numero',
        account: '12345678901',
        starts_on: '01/02/1990',
      }),
      formResponse(4, { bank_name: 'Banco ItauBank S.A' }),
    ];

    const response = await upload(launch.id, await makeFormXlsx(responses));

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      created: 4,
      updated: 0,
      unchanged: 0,
      rejected: [],
      warnings: [],
    });
    expect(response.body.data.workers.map((w) => w.number)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(issuesOf(response.body, 1)).toEqual([]);
    expect(issuesOf(response.body, 2)).toEqual(['cpf_padded:cpf']);
    // Inicio igual ao nascimento: a data de 1990 tambem fica antes do
    // lancamento.
    expect(issuesOf(response.body, 3)).toEqual([
      'start_before_launch:starts_on',
      'start_equals_birth:starts_on',
      'address_without_number:address',
      'account_without_digit:account',
    ]);
    expect(issuesOf(response.body, 4)).toEqual(['bank_ambiguous:bank_code']);

    const { body } = await request(
      'GET',
      `/api/rpa/launches/${launch.id}/workers`,
    );
    expect(body.data[1]).toMatchObject({
      cpf: syntheticCpf(2, { leadingZero: true }),
      city: 'Avaré-SP',
      agency: '0001',
      cep: '18700000',
      bank_code: '260',
      account_type: 'checking',
      starts_on: '2026-10-13',
    });
    expect(body.data[3].bank_code).toBeNull();
  });

  it('le o .csv do Sheets e o do Excel em portugues, com ponto e virgula e Latin-1', async () => {
    const launch = await insertRpaLaunch(LAUNCH);
    const sheets = makeFormCsv([formResponse(1)]);
    const excel = makeFormCsv([formResponse(2, { name: 'João Sintético' })], {
      delimiter: ';',
      encoding: 'latin1',
    });

    const first = await upload(launch.id, sheets, 'respostas.csv');
    const second = await upload(launch.id, excel, 'respostas.csv');

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(second.body.data.workers.map((w) => w.name)).toEqual([
      'Pessoa Sintetica Numero 1',
      'João Sintético',
    ]);
  });

  it('coluna a mais, fora de ordem e titulo em outra caixa nao quebram', async () => {
    const launch = await insertRpaLaunch(LAUNCH);
    const buffer = await makeFormXlsx([formResponse(1)], {
      columns: ['cpf', 'name', 'city', 'bank_name', 'form_submitted_at'],
      extra: ['Tamanho da camiseta'],
    });

    const response = await upload(launch.id, buffer);

    expect(response.status).toBe(200);
    expect(response.body.data.created).toBe(1);
    expect(response.body.data.warnings).toEqual([
      {
        column: 'Tamanho da camiseta',
        message: 'pergunta nao reconhecida: ficou de fora',
      },
    ]);
  });

  it('reimportar o mesmo arquivo nao duplica ninguem', async () => {
    const launch = await insertRpaLaunch(LAUNCH);
    const buffer = await makeFormXlsx([formResponse(1), formResponse(2)]);

    await upload(launch.id, buffer);
    const again = await upload(launch.id, buffer);

    expect(again.body.data).toMatchObject({
      created: 0,
      updated: 0,
      unchanged: 2,
    });
    expect(again.body.data.workers).toHaveLength(2);
  });

  it('a resposta corrigida, mais nova, atualiza so aquela pessoa e diz o que mudou', async () => {
    const launch = await insertRpaLaunch(LAUNCH);
    await upload(
      launch.id,
      await makeFormXlsx([
        formResponse(1),
        formResponse(2, { address: 'Rua Sintetica Sem Numero' }),
      ]),
    );

    const corrected = formResponse(2, {
      address: 'Rua Sintetica, 321',
      form_submitted_at: '14/10/2026 08:00:00',
    });
    const response = await upload(
      launch.id,
      await makeFormXlsx([formResponse(1), corrected]),
    );

    expect(response.body.data).toMatchObject({
      created: 0,
      updated: 1,
      unchanged: 1,
    });
    expect(response.body.data.changes).toEqual([
      expect.objectContaining({ number: 2, fields: ['address'] }),
    ]);
    // Corrigir o endereco tira a pendencia dele.
    expect(issuesOf(response.body, 2)).toEqual([]);
  });

  it('a resposta mais velha nao desfaz a correcao feita depois', async () => {
    const launch = await insertRpaLaunch(LAUNCH);
    const newer = formResponse(1, {
      address: 'Rua Sintetica, 321',
      form_submitted_at: '14/10/2026 08:00:00',
    });
    await upload(launch.id, await makeFormXlsx([newer]));

    const response = await upload(
      launch.id,
      await makeFormXlsx([formResponse(1, { address: 'Rua Antiga, 1' })]),
    );

    expect(response.body.data.unchanged).toBe(1);

    const { body } = await request(
      'GET',
      `/api/rpa/launches/${launch.id}/workers`,
    );
    expect(body.data[0].address).toBe('Rua Sintetica, 321');
  });

  it('duas respostas da mesma pessoa no arquivo: vale a mais nova, com aviso pela linha', async () => {
    const launch = await insertRpaLaunch(LAUNCH);
    const buffer = await makeFormXlsx([
      formResponse(1, {
        role: 'Recepcionista',
        form_submitted_at: '14/10/2026 08:00:00',
      }),
      formResponse(1, { role: 'Assistente Administrativo' }),
    ]);

    const response = await upload(launch.id, buffer);

    expect(response.body.data.created).toBe(1);
    expect(response.body.data.warnings).toEqual([
      {
        column: null,
        message:
          'linhas 2 e 3 sao da mesma pessoa: valeu a resposta mais nova (linha 2)',
      },
    ]);

    const { body } = await request(
      'GET',
      `/api/rpa/launches/${launch.id}/workers`,
    );
    expect(body.data[0].role).toBe('Recepcionista');
  });

  it('linha sem CPF fica de fora, pelo numero, e o resto entra', async () => {
    const launch = await insertRpaLaunch(LAUNCH);
    const buffer = await makeFormXlsx([
      formResponse(1),
      formResponse(2, { cpf: '' }),
    ]);

    const response = await upload(launch.id, buffer);

    expect(response.body.data.created).toBe(1);
    expect(response.body.data.rejected).toEqual([
      { line: 3, reason: 'resposta sem CPF' },
    ]);
  });

  it('quem entra numa segunda importacao ganha o numero seguinte', async () => {
    const launch = await insertRpaLaunch(LAUNCH);
    await insertRpaWorker({
      launch_id: launch.id,
      number: 7,
      cpf: '52998224725',
    });

    const response = await upload(
      launch.id,
      await makeFormXlsx([formResponse(1)]),
    );

    expect(response.body.data.workers.map((w) => w.number)).toEqual([7, 8]);
  });

  it('planilha sem a pergunta de CPF responde 422 dizendo qual falta', async () => {
    const launch = await insertRpaLaunch(LAUNCH);
    const buffer = await makeFormXlsx([formResponse(1)], {
      columns: ['name', 'city'],
    });

    const response = await upload(launch.id, buffer);

    expect(response.status).toBe(422);
    expect(response.body.message).toBe('A planilha nao tem a pergunta de CPF.');
    expect(response.body.details).toEqual([
      { field: 'file', message: 'falta a pergunta de CPF' },
    ]);
  });

  it.each([
    ['PDF', () => makePdf()],
    ['imagem', async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])],
  ])('%s com nome de planilha responde 422 com action', async (_, make) => {
    const launch = await insertRpaLaunch(LAUNCH);

    const response = await upload(launch.id, await make(), 'respostas.xlsx');

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      expect.objectContaining({ field: 'file' }),
    ]);
    expect(response.body.action).toMatch(/\.xlsx ou \.csv/);
  });

  it('o .xlsb da planilha de controle responde 422 dizendo como salvar', async () => {
    const launch = await insertRpaLaunch(LAUNCH);
    // O .xlsb e zip como o .xlsx, mas o livro vem em binario: e o que o
    // distingue pelo conteudo.
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file('xl/workbook.bin', Buffer.from([0x83, 0x01, 0x00]));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    const response = await upload(launch.id, buffer, 'respostas.xlsx');

    expect(response.status).toBe(422);
    expect(response.body.message).toMatch(/\.xlsb/);
    expect(response.body.message).toMatch(/Salve como \.xlsx/);
  });

  it('sem arquivo responde 422 no campo file', async () => {
    const launch = await insertRpaLaunch(LAUNCH);

    const response = await request(
      'POST',
      `/api/rpa/launches/${launch.id}/import`,
    );

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      { field: 'file', message: 'arquivo obrigatorio' },
    ]);
  });

  it('lancamento encerrado recusa a importacao com 409', async () => {
    const launch = await insertRpaLaunch({ ...LAUNCH, status: 'closed' });

    const response = await upload(
      launch.id,
      await makeFormXlsx([formResponse(1)]),
    );

    expect(response.status).toBe(409);
  });

  it('a planilha nao fica no disco', async () => {
    const launch = await insertRpaLaunch(LAUNCH);
    const before = leftoverUploads().length;

    await upload(launch.id, await makeFormXlsx([formResponse(1)]));

    expect(leftoverUploads()).toHaveLength(before);
  });
});
