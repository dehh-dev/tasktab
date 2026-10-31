'use strict';

const JSZip = require('jszip');
const { PDFDocument } = require('pdf-lib');
const {
  request,
  requestBinary,
  insertRpaCompany,
  insertRpaLaunch,
  insertRpaWorker,
  insertRpaPayment,
  updateColumnDirectly,
} = require('../../orchestrator');
const { extractPdfText } = require('../../helpers/pdf-text');
const { renderPdfPage } = require('../../helpers/pdf-render');

/**
 * A emissao em lote (issue 40), com dados sinteticos de acento: "Conceição",
 * "São João", "1ª". A hora gravada na emissao (17h30min05 UTC, 14h30min05 em
 * Brasilia) vai no nome do arquivo.
 */
const ISSUED_AT = '2026-10-20T17:30:05Z';

async function arrange() {
  const company = await insertRpaCompany({
    code: 815,
    name: 'Empresa Sintética São João SPE Ltda',
    city: 'São João',
    state: 'SP',
  });
  const launch = await insertRpaLaunch({
    company_id: company.id,
    city: 'São João',
    state: 'SP',
    service_type: 'Prestação de Serviços Administrativos',
    cost_center: '71401',
    site: 'Residencial Sintético',
    product: 'Lançamento',
    supply: 'Mão de obra',
    email_to: ['financeiro@exemplo.test'],
    email_cc: ['obra@exemplo.test'],
  });
  const worker = await insertRpaWorker({
    launch_id: launch.id,
    number: 7,
    name: 'Maria da Conceição Sintética',
    pis: '12056412545',
    rg: '123456789',
    rg_issued_on: '2015-03-02',
    birth_date: '1990-02-01',
    birth_place: 'São João-SP',
    mother_name: 'Mãe Sintética',
    father_name: 'Pai Sintético',
    address: 'Rua Sintética, 100',
    district: 'Centro',
    city: 'São João-SP',
    cep: '18700000',
    bank_code: '260',
    bank_name: 'Banco Nubank',
    agency: '0001',
    account: '1234567-8',
    account_type: 'checking',
  });
  const payment = await insertRpaPayment({
    worker_id: worker.id,
    code: '1-815-7-102026',
    issued_at: ISSUED_AT,
  });

  return { company, launch, worker, payment };
}

function pdfOf(paymentId) {
  return requestBinary('GET', `/api/rpa/payments/${paymentId}/rpa.pdf`);
}

describe('GET /api/rpa/payments/:id/rpa.pdf', () => {
  it('uma pagina Carta com todos os campos do formulario', async () => {
    const { payment } = await arrange();

    const response = await pdfOf(payment.id);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');

    const doc = await PDFDocument.load(response.buffer);
    expect(doc.getPageCount()).toBe(1);
    const page = renderPdfPage(response.buffer, 1);
    expect([page.width, page.height]).toEqual([612, 792]);

    const [text] = extractPdfText(response.buffer);
    for (const field of [
      '1-815-7-102026',
      'MARIA DA CONCEIÇÃO SINTÉTICA',
      '529.982.247-25',
      '120.56412.54-5',
      '123456789',
      '02/03/2015',
      '01/02/1990',
      'MÃE SINTÉTICA',
      'PAI SINTÉTICO',
      '260 - BANCO NUBANK',
      '0001',
      '1234567-8',
      'CORRENTE',
      '18700-000',
      'RUA SINTÉTICA, 100',
      '815 - Empresa Sintética São João SPE Ltda',
      'SÃO JOÃO-SP',
      '71401',
      'Prestação de Serviços Administrativos',
      '13/10/2026 até 19/10/2026',
      '20/10/2026',
      'R$ 730,33',
      'R$ 80,33',
      'R$ 123,13',
      'R$ 650,00',
    ]) {
      expect(text).toContain(field);
    }
  });

  it('o nome do arquivo leva acento e ª, com a alternativa ASCII', async () => {
    const { payment } = await arrange();

    const response = await pdfOf(payment.id);

    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="Solicitacao - RPA - 1a Pagto -Maria Sintetica_20-10-2026_143005.pdf"; ' +
        "filename*=UTF-8''Solicita%C3%A7%C3%A3o%20-%20RPA%20-%201%C2%AA%20Pagto%20-Maria%20Sint%C3%A9tica_20-10-2026_143005.pdf",
    );
  });

  it('gerar de novo da o mesmo arquivo, byte a byte, com o mesmo nome', async () => {
    const { payment } = await arrange();

    const first = await pdfOf(payment.id);
    const second = await pdfOf(payment.id);

    expect(Buffer.compare(first.buffer, second.buffer)).toBe(0);
    // A data do PDF vai ate o segundo: duas geracoes no mesmo segundo sairiam
    // iguais por acaso. A data do documento e a da emissao, e nao a de agora.
    // `updateMetadata: false`: sem ele o proprio `load` regrava a data.
    const doc = await PDFDocument.load(first.buffer, {
      updateMetadata: false,
    });
    expect(doc.getCreationDate().toISOString()).toBe(
      '2026-10-20T17:30:05.000Z',
    );
    expect(doc.getModificationDate().toISOString()).toBe(
      '2026-10-20T17:30:05.000Z',
    );
    expect(second.headers.get('content-disposition')).toBe(
      first.headers.get('content-disposition'),
    );
  });

  it('as tabelas impressas sao as que o RPA guardou na emissao', async () => {
    const { payment } = await arrange();

    const [text] = extractPdfText((await pdfOf(payment.id)).buffer);

    // INSS e IRRF de 2026: teto de R$ 8.475,55 e a reducao da Lei 15.270.
    expect(text).toContain('R$ 8.475,55');
    expect(text).toContain('Redução da Lei 15.270/2025');
  });

  it('RPA cancelado nao se imprime', async () => {
    const { payment } = await arrange();
    await request('POST', `/api/rpa/payments/${payment.id}/cancel`, {
      reason: 'erro',
    });

    const response = await request(
      'GET',
      `/api/rpa/payments/${payment.id}/rpa.pdf`,
    );

    expect(response.status).toBe(409);
  });

  it('sem tipo de servico e centro de custo responde 422, em vez de imprimir 0', async () => {
    const { launch, payment } = await arrange();
    await updateColumnDirectly('rpa_launches', launch.id, 'service_type', null);
    await updateColumnDirectly('rpa_launches', launch.id, 'cost_center', null);

    const response = await request(
      'GET',
      `/api/rpa/payments/${payment.id}/rpa.pdf`,
    );

    expect(response.status).toBe(422);
    expect(response.body.details.map((detail) => detail.field)).toEqual([
      'service_type',
      'cost_center',
    ]);
  });
});

/** As flags de cada arquivo no .zip, lidas do cabecalho local. */
function zipNameFlags(buffer) {
  const flags = [];
  for (let at = 0; at < buffer.length - 4; at += 1) {
    if (buffer.readUInt32LE(at) === 0x04034b50) {
      flags.push(buffer.readUInt16LE(at + 6));
    }
  }
  return flags;
}

describe('GET /api/rpa/launches/:id/rpas.zip', () => {
  it('um PDF por pessoa do pagamento pedido, com os nomes em UTF-8', async () => {
    const { launch, worker } = await arrange();
    const joao = await insertRpaWorker({
      launch_id: launch.id,
      number: 8,
      cpf: '11144477735',
      name: 'João Sintético de Araújo',
    });
    await insertRpaPayment({
      worker_id: joao.id,
      code: '1-815-8-102026',
      issued_at: ISSUED_AT,
    });
    // O 2o pagamento da mesma pessoa fica de fora.
    await insertRpaPayment({
      worker_id: worker.id,
      number: 2,
      code: '2-815-7-102026',
      issued_at: ISSUED_AT,
    });

    const response = await requestBinary(
      'GET',
      `/api/rpa/launches/${launch.id}/rpas.zip?payment=1`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('content-disposition')).toContain(
      "filename*=UTF-8''RPAs%20-%201%C2%AA%20Pagto%20-%20S%C3%A3o%20Jo%C3%A3o-SP.zip",
    );

    const zip = await JSZip.loadAsync(response.buffer);
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual([
      'Solicitação - RPA - 1ª Pagto -João Araújo_20-10-2026_143005.pdf',
      'Solicitação - RPA - 1ª Pagto -Maria Sintética_20-10-2026_143005.pdf',
    ]);
    // Bit 11: o nome esta em UTF-8, e o Windows o abre com acento.
    expect(zipNameFlags(response.buffer).every((flag) => flag & 0x0800)).toBe(
      true,
    );

    const joaoPdf = await zip.file(names[0]).async('nodebuffer');
    expect(
      await PDFDocument.load(joaoPdf).then((doc) => doc.getPageCount()),
    ).toBe(1);
    expect(extractPdfText(joaoPdf)[0]).toContain('JOÃO SINTÉTICO DE ARAÚJO');
  });

  it('sem ?payment, ou sem RPA com o numero, responde 422 no campo', async () => {
    const { launch } = await arrange();

    const missing = await request(
      'GET',
      `/api/rpa/launches/${launch.id}/rpas.zip`,
    );
    const none = await request(
      'GET',
      `/api/rpa/launches/${launch.id}/rpas.zip?payment=3`,
    );

    expect(missing.status).toBe(422);
    expect(missing.body.details).toEqual([
      { field: 'payment', message: 'payment deve ser o numero do pagamento' },
    ]);
    expect(none.status).toBe(422);
    expect(none.body.details).toEqual([
      { field: 'payment', message: 'nenhum RPA com este numero' },
    ]);
  });
});

describe('GET /api/rpa/launches/:id/email', () => {
  it('traz o assunto, os destinatarios e os campos do lancamento com a data do pagamento', async () => {
    const { launch } = await arrange();

    const response = await request(
      'GET',
      `/api/rpa/launches/${launch.id}/email?payment=1`,
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      payment: 1,
      count: 1,
      reply: false,
      subject: 'SOLICITAÇÃO DE EMISSÃO RPA - LANÇAMENTO SÃO JOÃO/SP - EMP. 815',
      to: ['financeiro@exemplo.test'],
      cc: ['obra@exemplo.test'],
    });
    expect(response.body.data.text).toBe(
      [
        'Solicito emissão de RPA da equipe administrativa de lançamento em São João/SP.',
        '',
        'Empresa: 815 - Empresa Sintética São João SPE Ltda',
        'Obra: Residencial Sintético',
        'Produto: Lançamento',
        'Insumo: Mão de obra',
        'Data para pagamento: 20/10/2026',
        '',
        'Segue em anexo 1 RPA.',
      ].join('\n'),
    );
    expect(response.body.data.html).toContain(
      'Data para pagamento: <strong style="color:#c00000">20/10/2026</strong>',
    );
  });

  it('do 2o pagamento em diante, e o texto da resposta na mesma conversa', async () => {
    const { launch, worker } = await arrange();
    await insertRpaPayment({
      worker_id: worker.id,
      number: 2,
      code: '2-815-7-102026',
      payment_date: '2026-10-27',
    });

    const response = await request(
      'GET',
      `/api/rpa/launches/${launch.id}/email?payment=2`,
    );

    expect(response.body.data.reply).toBe(true);
    expect(response.body.data.text).toContain(
      'Solicito emissão de RPA do 2º pagamento',
    );
    expect(response.body.data.text).toContain(
      'Data para pagamento: 27/10/2026',
    );
  });
});
