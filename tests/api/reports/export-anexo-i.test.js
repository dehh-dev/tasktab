'use strict';

const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const fs = require('fs/promises');
const {
  requestBinary,
  insertReport,
  insertReceipt,
  insertMerchant,
} = require('../../orchestrator');
const anexoI = require('../../../src/services/export/anexo-i.service');

async function loadAnexo(reportId) {
  const response = await requestBinary(
    'GET',
    `/api/reports/${reportId}/export/anexo-i.xlsx`,
  );
  const workbook = new ExcelJS.Workbook();
  if (response.status === 200) {
    await workbook.xlsx.load(response.buffer);
  }
  return { response, workbook };
}

describe('GET /api/reports/:id/export/anexo-i.xlsx', () => {
  it('preenche a primeira linha do template e mantem as formulas', async () => {
    const report = await insertReport({ advance_cents: 150000 });
    const merchant = await insertMerchant({
      name: 'Franguinho na Panela',
      city: 'Abadiânia',
      default_category: 'alimentacao',
    });
    await insertReceipt(report.id, {
      issued_at: '2026-06-19',
      amount_cents: 3760,
      category: 'alimentacao',
      status: 'confirmed',
      merchant_id: merchant.id,
    });

    const { response, workbook } = await loadAnexo(report.id);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain(
      `anexo-i-${report.id}.xlsx`,
    );

    const sheet = workbook.getWorksheet('Anexo I');
    expect(sheet.getCell('B32').value).toEqual(new Date(Date.UTC(2026, 5, 19)));
    expect(sheet.getCell('C32').value).toBe('Abadiânia');
    expect(sheet.getCell('G32').value).toMatch(/Franguinho/);
    expect(sheet.getCell('S32').value).toBe(37.6);

    // A formula da linha e a do total nunca sao tocadas pelo remendo.
    expect(sheet.getCell('Y32').value).toEqual({ formula: 'S32+W32+X32' });
    expect(sheet.getCell('Y101').value).toEqual({
      formula: 'SUM(Y32:Y100)',
    });
  });

  it('so inclui comprovantes confirmados', async () => {
    const report = await insertReport();
    await insertReceipt(report.id, {
      page_number: 1,
      status: 'needs_review',
      issued_at: '2026-06-19',
      amount_cents: 1000,
      category: 'alimentacao',
    });
    await insertReceipt(report.id, {
      page_number: 2,
      status: 'confirmed',
      issued_at: '2026-06-20',
      amount_cents: 2000,
      category: 'alimentacao',
    });

    const { workbook } = await loadAnexo(report.id);
    const sheet = workbook.getWorksheet('Anexo I');

    // So o confirmado ocupa a linha 32 — o needs_review nao entra em lugar
    // nenhum do formulario oficial.
    expect(sheet.getCell('S32').value).toBe(20);
    expect(sheet.getCell('B33').value).toBeNull();
  });

  it('preserva a lista suspensa de validacao, que o remendo nunca toca', async () => {
    const report = await insertReport();
    await insertReceipt(report.id, {
      status: 'confirmed',
      issued_at: '2026-06-19',
      amount_cents: 1000,
      category: 'alimentacao',
    });

    const { workbook } = await loadAnexo(report.id);
    const sheet = workbook.getWorksheet('Anexo I');

    expect(sheet.getCell('T32').dataValidation).toEqual({
      type: 'list',
      allowBlank: true,
      formulae: ['"Dinheiro,Cartao,Pix"'],
    });
  });

  it('so as celulas de dados mudam no zip do arquivo', async () => {
    const report = await insertReport();
    await insertReceipt(report.id, {
      status: 'confirmed',
      issued_at: '2026-06-19',
      amount_cents: 1000,
      category: 'alimentacao',
    });

    const { response } = await loadAnexo(report.id);

    const originalBuffer = await fs.readFile(anexoI.TEMPLATE_PATH);
    const before = await JSZip.loadAsync(originalBuffer);
    const after = await JSZip.loadAsync(response.buffer);

    const changed = [];
    for (const name of Object.keys(before.files)) {
      if (before.files[name].dir) {
        continue;
      }
      const originalEntry = await before.file(name).async('nodebuffer');
      const generatedEntry = await after.file(name).async('nodebuffer');
      if (!originalEntry.equals(generatedEntry)) {
        changed.push(name);
      }
    }

    // So a planilha (celulas de dados) e o workbook (fullCalcOnLoad) mudam;
    // estilos, tema e a lista de strings compartilhadas ficam intocados.
    expect(changed.sort()).toEqual(
      ['xl/workbook.xml', 'xl/worksheets/sheet1.xml'].sort(),
    );
  });

  it('rejeita relatorio com mais lancamentos do que o template comporta', async () => {
    const report = await insertReport();

    for (let page = 1; page <= anexoI.MAX_ROWS + 1; page += 1) {
      await insertReceipt(report.id, {
        page_number: page,
        status: 'confirmed',
        issued_at: '2026-06-19',
        amount_cents: 100,
        category: 'alimentacao',
      });
    }

    const response = await requestBinary(
      'GET',
      `/api/reports/${report.id}/export/anexo-i.xlsx`,
    );

    expect(response.status).toBe(422);
  });

  it('retorna 404 para relatorio inexistente', async () => {
    const response = await requestBinary(
      'GET',
      '/api/reports/999999/export/anexo-i.xlsx',
    );

    expect(response.status).toBe(404);
  });
});
