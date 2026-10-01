'use strict';

const {
  requestBinary,
  request,
  requestUpload,
  waitForProcessing,
  insertReport,
  createUserWithSession,
} = require('../../orchestrator');
const { makeReceiptPdf } = require('../../fixtures/pdf');

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

    expect(etag).toMatch(/^".+-1"$/);
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
});
