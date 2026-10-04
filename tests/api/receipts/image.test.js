'use strict';

const fs = require('fs/promises');
const sharp = require('sharp');

const {
  requestBinary,
  request,
  requestUpload,
  waitForProcessing,
  insertReport,
  createUserWithSession,
  uploadedFilePath,
} = require('../../orchestrator');
const { makeReceiptPdf, makeCorruptPdf } = require('../../fixtures/pdf');

async function uploadOne(reportId, buffer) {
  await requestUpload(`/api/reports/${reportId}/receipts`, [
    { buffer, filename: 'a.pdf' },
  ]);
  await waitForProcessing(reportId);
  const list = await request('GET', `/api/reports/${reportId}/receipts`);
  return list.body.data[0];
}

describe('GET /api/receipts/:id/image', () => {
  it('devolve um PNG da pagina do comprovante', async () => {
    const report = await insertReport();
    const receipt = await uploadOne(report.id, await makeReceiptPdf());

    const response = await requestBinary(
      'GET',
      `/api/receipts/${receipt.id}/image`,
    );

    expect(response.status).toBe(200);
    // WebP e nao PNG: na pagina escaneada de 4000x1908 medida durante o ajuste,
    // o PNG saia com 2913 KB e o WebP q92 com 451 KB — quatro vezes menos que
    // o PNG a 3x que era servido antes, e ainda assim com mais resolucao.
    expect(response.headers.get('content-type')).toBe('image/webp');
    // Container RIFF com o marcador WEBP no byte 8.
    expect(response.buffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(response.buffer.subarray(8, 12).toString('ascii')).toBe('WEBP');
  });

  it('girada na revisao, a pagina sai girada e com outro ETag', async () => {
    const report = await insertReport();
    // Cupom em pe: 300 x 400 pontos.
    const receipt = await uploadOne(report.id, await makeReceiptPdf());

    const antes = await requestBinary(
      'GET',
      `/api/receipts/${receipt.id}/image`,
    );
    await request('PATCH', `/api/receipts/${receipt.id}`, { rotation: 90 });
    // O navegador revalida com o ETag de antes do giro: ele nao pode servir.
    const depois = await requestBinary(
      'GET',
      `/api/receipts/${receipt.id}/image`,
      { headers: { 'If-None-Match': antes.headers.get('etag') } },
    );

    const de = await sharp(antes.buffer).metadata();
    const para = await sharp(depois.buffer).metadata();

    expect(depois.status).toBe(200);
    expect(depois.headers.get('etag')).toMatch(/-1-90"$/);
    expect(de.width).toBeLessThan(de.height);
    expect([para.width, para.height]).toEqual([de.height, de.width]);
  });

  it('guarda so para revalidar: 304 quando o ETag bate, com a mesma politica', async () => {
    const report = await insertReport();
    const receipt = await uploadOne(report.id, await makeReceiptPdf());
    const imagePath = `/api/receipts/${receipt.id}/image`;

    const first = await requestBinary('GET', imagePath);
    const etag = first.headers.get('etag');
    const again = await requestBinary('GET', imagePath, {
      headers: { 'If-None-Match': etag },
    });

    // `no-cache` guarda, mas obriga o navegador a perguntar antes de cada uso,
    // e a pergunta passa pela sessao. O 304 repete os dois headers: sem eles
    // herdaria o `no-store` da API e o navegador descartaria a copia.
    const policy = (response) =>
      `${response.status} ${response.headers.get('cache-control')} ${response.headers.get('etag')}`;

    // Hash do arquivo, pagina e rotacao: o ETag so muda quando a revisao gira.
    expect(etag).toMatch(/^".+-1-0"$/);
    expect([policy(first), policy(again)]).toEqual([
      `200 private, no-cache ${etag}`,
      `304 private, no-cache ${etag}`,
    ]);
  });

  it('revalidar nao dispensa a posse: o ETag certo nao e credencial', async () => {
    const report = await insertReport();
    const receipt = await uploadOne(report.id, await makeReceiptPdf());
    const imagePath = `/api/receipts/${receipt.id}/image`;
    const { headers } = await requestBinary('GET', imagePath);
    const outsider = await createUserWithSession({ role: 'user' });

    // Quem nao alcanca o relatorio recebe o mesmo 404 de quem nunca viu a
    // imagem, e nao um 304 que validaria a copia guardada no navegador.
    const response = await requestBinary('GET', imagePath, {
      token: outsider.token,
      headers: { 'If-None-Match': headers.get('etag') },
    });

    expect(response.status).toBe(404);
  });

  it('arquivo ausente no disco e 422: reenviar e o que resolve', async () => {
    const report = await insertReport();
    const buffer = await makeReceiptPdf();
    const receipt = await uploadOne(report.id, buffer);
    await fs.unlink(uploadedFilePath(receipt.file_path));

    const response = await request('GET', `/api/receipts/${receipt.id}/image`);

    expect(response.status).toBe(422);
    expect(response.body.name).toBe('ValidationError');
    expect(response.body.details).toEqual([
      { field: 'file_path', message: 'arquivo ausente' },
    ]);

    // O reenvio do mesmo arquivo nao cria linha nova: devolve o que sumiu.
    // Antes ele descartava a copia, e a orientacao acima nao resolvia nada.
    const reenvio = await requestUpload(`/api/reports/${report.id}/receipts`, [
      { buffer, filename: 'de-novo.pdf' },
    ]);
    const depois = await requestBinary(
      'GET',
      `/api/receipts/${receipt.id}/image`,
    );

    expect(reenvio.body.meta).toEqual({ created: 0, existing: 1 });
    expect(depois.status).toBe(200);
  });

  it('PDF que o pdf.js recusa e 422, sem a mensagem interna no corpo', async () => {
    const report = await insertReport();
    const receipt = await uploadOne(report.id, makeCorruptPdf());

    const response = await request('GET', `/api/receipts/${receipt.id}/image`);

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      { field: 'file_path', message: 'PDF ilegivel' },
    ]);
    expect(JSON.stringify(response.body)).not.toContain('Invalid PDF');
  });

  it('falha de leitura que nao e arquivo ausente e 500, nao "reenvie o PDF"', async () => {
    const report = await insertReport();
    const receipt = await uploadOne(report.id, await makeReceiptPdf());
    const filePath = uploadedFilePath(receipt.file_path);

    // Um diretorio no lugar do arquivo da EISDIR: falha real de disco, que
    // nenhum reenvio conserta.
    await fs.unlink(filePath);
    await fs.mkdir(filePath);

    try {
      const response = await request(
        'GET',
        `/api/receipts/${receipt.id}/image`,
      );

      expect(response.status).toBe(500);
      expect(response.body.name).toBe('InternalServerError');
      expect(response.body.request_id).toEqual(expect.any(String));
    } finally {
      await fs.rmdir(filePath);
    }
  });
});
