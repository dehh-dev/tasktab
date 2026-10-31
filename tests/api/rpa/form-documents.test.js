'use strict';

const crypto = require('crypto');
const fs = require('fs');
const JSZip = require('jszip');
const sharp = require('sharp');
const {
  request,
  requestUpload,
  requestBinary,
  insertRpaLaunch,
  insertRpaWorker,
  leftoverUploads,
  uploadedFilePath,
} = require('../../orchestrator');
const {
  QUESTIONS,
  photo,
  phonePhoto,
  bigPdf,
  makeDriveZip,
  rawZip,
} = require('../../fixtures/drive');
const { makePdf } = require('../../fixtures/pdf');

/**
 * Os documentos do formulario (issue 41): o .zip do Drive entra, cada
 * arquivo vai para a pessoa e o tipo, e sai um .zip com uma pasta por pessoa.
 */
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

async function arrange() {
  const launch = await insertRpaLaunch({ city: 'Avaré', state: 'SP' });
  const maria = await insertRpaWorker({
    launch_id: launch.id,
    number: 1,
    name: 'Maria da Conceição Silva',
  });
  const joao = await insertRpaWorker({
    launch_id: launch.id,
    number: 2,
    cpf: '11144477735',
    name: 'João Araújo',
  });
  return { launch, maria, joao };
}

function upload(launchId, buffer) {
  return requestUpload(
    `/api/rpa/launches/${launchId}/documents`,
    [{ buffer, filename: 'Cadastro AVARE (File responses).zip' }],
    { field: 'file' },
  );
}

function downloadZip(launchId, query = '') {
  return requestBinary(
    'GET',
    `/api/rpa/launches/${launchId}/documents.zip${query}`,
  );
}

async function zipEntries(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const entries = {};
  for (const name of Object.keys(zip.files).sort()) {
    if (!zip.files[name].dir) {
      entries[name] = await zip.file(name).async('nodebuffer');
    }
  }
  return entries;
}

/** O formulario de duas pessoas, com um documento de ninguem e lixo. */
async function teamZip() {
  const files = {
    ctpsFront: await photo(1),
    ctpsBack: await photo(2),
    rg: await photo(3),
    address: await makePdf(),
    bank: await photo(4, { format: 'png' }),
    stranger: await photo(5),
  };
  const buffer = await makeDriveZip(
    [
      {
        question: QUESTIONS.ctpsFront,
        name: 'IMG_0001 - Maria Silva.jpg',
        data: files.ctpsFront,
      },
      {
        question: QUESTIONS.ctpsBack,
        name: 'IMG_0002 - Maria Silva.jpg',
        data: files.ctpsBack,
      },
      // A mesma foto mandada como frente e como verso do RG.
      {
        question: QUESTIONS.idFront,
        name: 'rg - Maria Silva.jpg',
        data: files.rg,
      },
      {
        question: QUESTIONS.idBack,
        name: 'rg - Maria Silva.jpg',
        data: files.rg,
      },
      {
        question: QUESTIONS.address,
        name: 'conta de luz - Joao Araujo.pdf',
        data: files.address,
      },
      {
        question: QUESTIONS.bank,
        name: 'print - João Araújo.png',
        data: files.bank,
      },
      {
        question: QUESTIONS.address,
        name: 'comprovante - Zé Ninguém.jpg',
        data: files.stranger,
      },
      {
        question: 'Outra pergunta (File responses)',
        name: 'x - Maria Silva.jpg',
        data: await photo(6),
      },
      {
        question: QUESTIONS.ctpsFront,
        name: 'leia-me - Maria Silva.jpg',
        data: Buffer.from('nao e foto'),
      },
    ],
    {
      extra: [
        {
          path: '__MACOSX/._IMG_0001 - Maria Silva.jpg',
          data: Buffer.from('lixo'),
        },
      ],
    },
  );
  return { buffer, files };
}

describe('POST /api/rpa/launches/:id/documents', () => {
  it('organiza por pessoa e por tipo, e lista o que nao casou', async () => {
    const { launch, maria, joao } = await arrange();
    const { buffer, files } = await teamZip();

    const response = await upload(launch.id, buffer);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      received: 7,
      stored: 6,
      repeated: 1,
      created: 6,
      rejected: [
        expect.objectContaining({ reason: 'pasta de pergunta desconhecida' }),
        expect.objectContaining({ reason: 'nao e foto nem PDF' }),
      ],
    });

    const documents = response.body.data.documents.map((document) => [
      document.worker_id,
      document.kind,
      document.side,
      document.content_type,
    ]);
    expect(documents).toEqual([
      [maria.id, 'ctps', 'front', 'image/jpeg'],
      [maria.id, 'ctps', 'back', 'image/jpeg'],
      // Frente igual ao verso: um arquivo, sem lado.
      [maria.id, 'id_document', null, 'image/jpeg'],
      [joao.id, 'address_proof', null, 'application/pdf'],
      [joao.id, 'bank_details', null, 'image/png'],
      [null, 'address_proof', null, 'image/jpeg'],
    ]);
    expect(response.body.data.documents.at(-1).source_name).toBe('Zé Ninguém');
    expect(
      fs.existsSync(uploadedFilePath(`${sha256(files.address)}.pdf`)),
    ).toBe(true);
  });

  it('reenviar o mesmo .zip nao duplica', async () => {
    const { launch } = await arrange();
    const { buffer } = await teamZip();
    await upload(launch.id, buffer);

    const again = await upload(launch.id, buffer);

    expect(again.body.data).toMatchObject({ stored: 6, created: 0 });
    expect(again.body.data.documents).toHaveLength(6);
  });

  it('o .zip enviado nao fica no disco', async () => {
    const { launch } = await arrange();
    const before = leftoverUploads().length;

    await upload(launch.id, (await teamZip()).buffer);
    await upload(launch.id, Buffer.from('nao e zip'));

    expect(leftoverUploads()).toHaveLength(before);
  });

  it('lancamento encerrado recusa com 409, e sem arquivo e 422', async () => {
    const { launch } = await arrange();
    const closed = await insertRpaLaunch({ status: 'closed' });

    const refused = await upload(closed.id, (await teamZip()).buffer);
    const empty = await request(
      'POST',
      `/api/rpa/launches/${launch.id}/documents`,
    );

    expect(refused.status).toBe(409);
    expect(empty.status).toBe(422);
    expect(empty.body.details).toEqual([
      { field: 'file', message: 'arquivo obrigatorio' },
    ]);
  });
});

describe('POST /api/rpa/launches/:id/documents: defesa de zip', () => {
  async function refused(buffer) {
    const { launch } = await arrange();
    const response = await upload(launch.id, buffer);
    const listed = await request(
      'GET',
      `/api/rpa/launches/${launch.id}/documents`,
    );
    return { response, documents: listed.body.data };
  }

  const ctps = `x/${QUESTIONS.ctpsFront}`;

  it('arquivo que passa de 50 MB descompactado e recusado antes de descompactar', async () => {
    const { response, documents } = await refused(
      rawZip([
        {
          name: `${ctps}/a - Maria Silva.jpg`,
          data: Buffer.alloc(60 * 1024 * 1024),
        },
      ]),
    );

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      {
        field: 'file',
        message: 'um arquivo do .zip passa de 50 MB descompactado',
      },
    ]);
    expect(response.body.action).toMatch(/Drive/);
    expect(documents).toEqual([]);
  });

  it('bomba que mente o tamanho para no primeiro byte a mais', async () => {
    const { response, documents } = await refused(
      rawZip([
        {
          name: `${ctps}/a - Maria Silva.jpg`,
          data: Buffer.alloc(20 * 1024 * 1024),
          declaredSize: 1024,
        },
      ]),
    );

    expect(response.status).toBe(422);
    expect(response.body.details[0].message).toBe(
      'um arquivo do .zip descompacta mais do que declara',
    );
    expect(documents).toEqual([]);
  });

  it('mais de 2.000 entradas e recusado pelo diretorio central', async () => {
    const entries = Array.from({ length: 2001 }, (_, index) => ({
      name: `${ctps}/${index} - Maria Silva.jpg`,
      data: Buffer.from([index % 256]),
    }));

    const { response } = await refused(rawZip(entries));

    expect(response.status).toBe(422);
    expect(response.body.details[0].message).toBe(
      'o .zip tem mais de 2000 arquivos',
    );
  });

  it('o que nao e .zip e recusado', async () => {
    const { response } = await refused(Buffer.from('%PDF-1.7 nao e zip'));

    expect(response.status).toBe(422);
    expect(response.body.details[0].message).toBe('o arquivo nao e um .zip');
  });

  it('o nome da entrada nunca vira caminho: o arquivo vai pelo hash', async () => {
    const data = await photo(9);
    const { launch } = await arrange();

    const response = await upload(
      launch.id,
      rawZip([
        { name: `${ctps}/../../../../tmp/fora - Maria Silva.jpg`, data },
      ]),
    );

    expect(response.status).toBe(200);
    expect(fs.existsSync(uploadedFilePath(`${sha256(data)}.jpg`))).toBe(true);
    expect(fs.existsSync('/tmp/fora - Maria Silva.jpg')).toBe(false);
  });
});

describe('PATCH /api/rpa/files/:id', () => {
  it('escolher a pessoa poe o documento na pasta dela', async () => {
    const { launch, joao } = await arrange();
    const imported = await upload(launch.id, (await teamZip()).buffer);
    const stranger = imported.body.data.documents.at(-1);

    const response = await request('PATCH', `/api/rpa/files/${stranger.id}`, {
      worker_id: joao.id,
    });
    const zip = await zipEntries((await downloadZip(launch.id)).buffer);

    expect(response.body.data).toMatchObject({
      worker_id: joao.id,
      worker_number: 2,
    });
    expect(Object.keys(zip)).toContain('JOÃO ARAÚJO/CE.jpg');
  });

  it('pessoa de outro lancamento e tipo invalido respondem 422', async () => {
    const { launch } = await arrange();
    const imported = await upload(launch.id, (await teamZip()).buffer);
    const document = imported.body.data.documents[0];
    const other = await insertRpaWorker();

    const foreign = await request('PATCH', `/api/rpa/files/${document.id}`, {
      worker_id: other.id,
    });
    const invalid = await request('PATCH', `/api/rpa/files/${document.id}`, {
      kind: 'signed_receipt',
      side: 'meio',
    });

    expect(foreign.body.details).toEqual([
      { field: 'worker_id', message: 'a pessoa nao e deste lancamento' },
    ]);
    expect(invalid.body.details.map((detail) => detail.field)).toEqual([
      'kind',
      'side',
    ]);
  });
});

describe('GET /api/rpa/launches/:id/documents.zip', () => {
  // Teste e desenvolvimento dividem o diretorio de upload: os arquivos de
  // varios MB destes testes saem dele no fim, e por serem deterministicos
  // (`seededBytes`) nunca ha mais de uma copia de cada.
  const large = [];

  function rememberLarge(data, extension) {
    large.push(uploadedFilePath(`${sha256(data)}.${extension}`));
    return data;
  }

  afterAll(() => {
    for (const file of large) fs.rmSync(file, { force: true });
  });

  it('uma pasta NOME SOBRENOME por pessoa, com o prefixo do tipo, e os arquivos como vieram', async () => {
    const { launch } = await arrange();
    const { buffer, files } = await teamZip();
    await upload(launch.id, buffer);

    const response = await downloadZip(launch.id);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('content-disposition')).toContain(
      "filename*=UTF-8''Documentos%20-%20Avar%C3%A9-SP.zip",
    );

    const zip = await zipEntries(response.buffer);
    // O documento sem pessoa fica de fora.
    expect(Object.keys(zip)).toEqual([
      'JOÃO ARAÚJO/CE.pdf',
      'JOÃO ARAÚJO/DB.png',
      'MARIA SILVA/CTPS FRENTE.jpg',
      'MARIA SILVA/CTPS VERSO.jpg',
      'MARIA SILVA/RG-CNH.jpg',
    ]);
    expect(Buffer.compare(zip['MARIA SILVA/RG-CNH.jpg'], files.rg)).toBe(0);
    expect(Buffer.compare(zip['JOÃO ARAÚJO/CE.pdf'], files.address)).toBe(0);
  });

  it('a versao para e-mail de fotos 4032 x 3024 fica abaixo de 25 MB e legivel', async () => {
    const { launch } = await arrange();
    // Quatro fotos de celular (frente e verso da CTPS e do RG), de ~8 MB.
    const sides = [
      [QUESTIONS.ctpsFront, 'CTPS FRENTE'],
      [QUESTIONS.ctpsBack, 'CTPS VERSO'],
      [QUESTIONS.idFront, 'RG-CNH FRENTE'],
      [QUESTIONS.idBack, 'RG-CNH VERSO'],
    ];
    const files = [];
    for (const [index, [question]] of sides.entries()) {
      files.push({
        question,
        name: `IMG_${index} - Maria Silva.jpg`,
        data: rememberLarge(await phonePhoto(index), 'jpg'),
      });
    }
    await upload(launch.id, await makeDriveZip(files));

    const full = await downloadZip(launch.id);
    const email = await downloadZip(launch.id, '?email=true');

    // As originais passam dos 25 MB do Gmail; a versao para e-mail, nao.
    expect(full.buffer.length).toBeGreaterThan(25 * 1024 * 1024);
    expect(email.buffer.length).toBeLessThan(25 * 1024 * 1024);
    expect(email.headers.get('x-email-warning')).toBeNull();

    const zip = await zipEntries(email.buffer);
    for (const [, prefix] of sides) {
      const metadata = await sharp(zip[`MARIA SILVA/${prefix}.jpg`]).metadata();
      expect(metadata).toMatchObject({
        format: 'jpeg',
        width: 2400,
        height: 1800,
      });
    }
  }, 60000);

  it('o PDF segue como veio, e passando de 25 MB a resposta avisa', async () => {
    const { launch } = await arrange();
    // PDF nao e reduzido: dois de 13 MB passam do limite do Gmail.
    const big = (seed) => rememberLarge(bigPdf(seed, 13), 'pdf');
    await upload(
      launch.id,
      await makeDriveZip([
        {
          question: QUESTIONS.address,
          name: 'a - Maria Silva.pdf',
          data: big(1),
        },
        { question: QUESTIONS.bank, name: 'b - Maria Silva.pdf', data: big(2) },
      ]),
    );

    const response = await downloadZip(launch.id, '?email=true');

    expect(response.status).toBe(200);
    expect(response.headers.get('x-email-warning')).toBe(
      'O .zip tem 27 MB, acima dos 25 MB do Gmail: envie em mais de um e-mail.',
    );
  }, 60000);

  it('sem documento com pessoa responde 422', async () => {
    const { launch } = await arrange();

    const response = await request(
      'GET',
      `/api/rpa/launches/${launch.id}/documents.zip`,
    );

    expect(response.status).toBe(422);
  });
});
