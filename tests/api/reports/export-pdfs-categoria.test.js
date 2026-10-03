'use strict';

const JSZip = require('jszip');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { extractPdfText } = require('../../helpers/pdf-text');
const {
  renderPdfPage,
  maxPixelDifference,
} = require('../../helpers/pdf-render');
const { makeRotatedPdf } = require('../../fixtures/pdf');
const {
  request,
  requestBinary,
  insertReport,
  insertReceipt,
  saveUpload,
} = require('../../orchestrator');

/** Um PDF com uma marca de texto por pagina, para achar cada uma depois. */
async function makeMarkedPdf(...marks) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const mark of marks) {
    doc.addPage([200, 300]).drawText(mark, { x: 20, y: 150, size: 14, font });
  }

  return Buffer.from(await doc.save());
}

/** Um comprovante apontando para uma pagina de um arquivo ja gravado. */
function pagina(upload, pageNumber, overrides) {
  return {
    ...upload,
    page_number: pageNumber,
    status: 'confirmed',
    category: 'alimentacao',
    issued_at: '2026-06-19',
    amount_cents: 1000,
    ...overrides,
  };
}

async function loadZip(reportId) {
  const response = await requestBinary(
    'GET',
    `/api/reports/${reportId}/export/pdfs-por-categoria.zip`,
  );
  const zip = await JSZip.loadAsync(response.buffer);
  const files = {};

  for (const name of Object.keys(zip.files).sort()) {
    files[name] = await zip.file(name).async('nodebuffer');
  }

  return { response, files };
}

/** O texto de cada pagina de cada arquivo do ZIP. */
function marksOf(files) {
  return Object.fromEntries(
    Object.entries(files).map(([name, buffer]) => [
      name,
      extractPdfText(buffer).map((text) => text.trim()),
    ]),
  );
}

describe('GET /api/reports/:id/export/pdfs-por-categoria.zip', () => {
  it('um PDF por categoria com despesa, em ordem cronologica, num ZIP', async () => {
    const report = await insertReport();
    const lote = saveUpload(
      await makeMarkedPdf('Pagina A', 'Pagina B', 'Pagina C', 'Pagina E'),
    );
    const avulso = saveUpload(await makeMarkedPdf('Pagina D'));

    // Fora de ordem de proposito, e de um jeito que nem a ordem de envio nem
    // a inversa coincidem com a cronologica: a exportacao e quem ordena.
    await insertReceipt(
      report.id,
      pagina(lote, 1, { issued_at: '2026-06-20' }),
    );
    await insertReceipt(
      report.id,
      pagina(lote, 2, { category: 'combustivel', issued_at: '2026-06-19' }),
    );
    // A duplicata vai junto, como comprovacao.
    await insertReceipt(
      report.id,
      pagina(lote, 3, { status: 'duplicate', issued_at: '2026-06-18' }),
    );
    await insertReceipt(
      report.id,
      pagina(lote, 4, { issued_at: '2026-06-19' }),
    );
    // Sem categoria ainda: nem por isso a pagina some da entrega.
    await insertReceipt(
      report.id,
      pagina(avulso, 1, { status: 'needs_review', category: null }),
    );

    const { response, files } = await loadZip(report.id);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('content-disposition')).toContain(
      `comprovantes-${report.id}.zip`,
    );
    // Numeracao corrida, na ordem do enum, para ninguem procurar um arquivo
    // que faltou entre o 01 e o 03.
    expect(marksOf(files)).toEqual({
      '01_alimentacao.pdf': ['Pagina C', 'Pagina E', 'Pagina A'],
      '02_combustivel.pdf': ['Pagina B'],
      '03_sem-categoria.pdf': ['Pagina D'],
    });
  });

  it('toda pagina vai para exatamente um arquivo, e o total bate', async () => {
    const report = await insertReport();
    const marcas = Array.from({ length: 9 }, (_, index) => `Pagina ${index}`);
    const categorias = [
      'alimentacao',
      'combustivel',
      'transporte',
      'lavanderia',
      'outros',
      null,
    ];
    const status = ['confirmed', 'duplicate', 'needs_review', 'failed'];
    let numero = 0;

    // Tres arquivos enviados, com categoria, status e data misturados.
    for (const grupo of [
      marcas.slice(0, 4),
      marcas.slice(4, 7),
      marcas.slice(7),
    ]) {
      const lote = saveUpload(await makeMarkedPdf(...grupo));

      for (const page of grupo.keys()) {
        await insertReceipt(
          report.id,
          pagina(lote, page + 1, {
            category: categorias[numero % categorias.length],
            status: status[numero % status.length],
            issued_at: `2026-06-${10 + (numero % 5)}`,
          }),
        );
        numero += 1;
      }
    }

    const { files } = await loadZip(report.id);
    const todas = Object.values(marksOf(files)).flat();

    expect(todas).toHaveLength(marcas.length);
    expect([...todas].sort()).toEqual([...marcas].sort());
  });

  it.each([0, 90, 180, 270])(
    'a pagina com /Rotate %i e copiada como esta na origem, sem faixa',
    async (angle) => {
      const report = await insertReport();
      const source = await makeRotatedPdf(angle);
      await insertReceipt(report.id, pagina(saveUpload(source), 1));

      const { files } = await loadZip(report.id);
      const gerado = files['01_alimentacao.pdf'];
      const page = (await PDFDocument.load(gerado)).getPage(0);
      const origem = (await PDFDocument.load(source)).getPage(0);

      // Copiada, e nao embutida: o /Rotate segue atributo da pagina, e o
      // tamanho e o da origem — nenhuma faixa de carimbo foi acrescentada.
      expect(page.getRotation().angle).toBe(angle);
      expect(page.getSize()).toEqual(origem.getSize());

      const original = renderPdfPage(source, 1);
      const exportado = renderPdfPage(gerado, 1);

      expect([exportado.width, exportado.height]).toEqual([
        original.width,
        original.height,
      ]);
      expect(maxPixelDifference(original, exportado, original.height)).toBe(0);
    },
  );

  it('o giro escolhido na revisao soma ao /Rotate da origem', async () => {
    const report = await insertReport();
    const receipt = await insertReceipt(
      report.id,
      pagina(saveUpload(await makeRotatedPdf(90)), 1),
    );
    // 90 da origem mais 90 da revisao: a pagina sai a 180, sem que o arquivo
    // original seja regravado.
    await request('PATCH', `/api/receipts/${receipt.id}`, { rotation: 90 });

    const { files } = await loadZip(report.id);
    const gerado = files['01_alimentacao.pdf'];

    expect(
      (await PDFDocument.load(gerado)).getPage(0).getRotation().angle,
    ).toBe(180);

    const esperado = renderPdfPage(await makeRotatedPdf(180), 1);
    const exportado = renderPdfPage(gerado, 1);

    expect(exportado.width).toBe(esperado.width);
    expect(maxPixelDifference(esperado, exportado, esperado.height)).toBe(0);
  });

  it('relatorio sem comprovantes gera um ZIP vazio', async () => {
    const report = await insertReport();

    const { response, files } = await loadZip(report.id);

    expect(response.status).toBe(200);
    expect(files).toEqual({});
  });
});
