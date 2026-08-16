'use strict';

const ExcelJS = require('exceljs');
const {
  requestBinary,
  insertReport,
  insertReceipt,
} = require('../../orchestrator');

async function loadWorkbook(reportId) {
  const response = await requestBinary(
    'GET',
    `/api/reports/${reportId}/export.xlsx`,
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(response.buffer);
  return { response, workbook };
}

describe('GET /api/reports/:id/export.xlsx', () => {
  it('gera a planilha com content-type e nome de arquivo corretos', async () => {
    const report = await insertReport();

    const { response } = await loadWorkbook(report.id);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.headers.get('content-disposition')).toContain(
      `relatorio-${report.id}.xlsx`,
    );
  });

  it('grava data como data de verdade e valor com formato pt-BR', async () => {
    const report = await insertReport();
    await insertReceipt(report.id, {
      issued_at: '2026-06-19',
      amount_cents: 3760,
      category: 'alimentacao',
      status: 'confirmed',
    });

    const { workbook } = await loadWorkbook(report.id);
    const sheet = workbook.getWorksheet('Resumo');

    expect(sheet.getCell('A2').value).toEqual(new Date(Date.UTC(2026, 5, 19)));
    expect(sheet.getCell('A2').numFmt).toBe('DD/MM/YYYY');
    expect(sheet.getCell('E2').value).toBe(37.6);
    // [$R$-416] e o codigo de moeda pt-BR do Excel — sem ele o separador
    // segue o locale de quem abre o arquivo.
    expect(sheet.getCell('E2').numFmt).toBe('[$R$-416] #,##0.00');
  });

  it('total geral e formula, nao valor fixo', async () => {
    const report = await insertReport();
    await insertReceipt(report.id, {
      page_number: 1,
      amount_cents: 3760,
      category: 'alimentacao',
      status: 'confirmed',
      issued_at: '2026-06-19',
    });
    await insertReceipt(report.id, {
      page_number: 2,
      amount_cents: 2436,
      category: 'transporte',
      status: 'confirmed',
      issued_at: '2026-06-20',
    });

    const { workbook } = await loadWorkbook(report.id);
    const sheet = workbook.getWorksheet('Resumo');

    const total = sheet.getCell('E5').value;
    expect(total).toEqual({ formula: 'SUMIFS(E2:E3,F2:F3,0)' });

    // Os valores brutos que a formula referencia batem com o esperado — a
    // semantica do SUMIFS (somar E onde F=0) e Excel padrao, verificada
    // manualmente com HyperFormula durante o desenvolvimento.
    expect(sheet.getCell('E2').value).toBe(37.6);
    expect(sheet.getCell('F2').value).toBe(0);
    expect(sheet.getCell('E3').value).toBe(24.36);
    expect(sheet.getCell('F3').value).toBe(0);
  });

  it('duplicata fica marcada e a coluna auxiliar exclui do total', async () => {
    const report = await insertReport();
    await insertReceipt(report.id, {
      page_number: 1,
      amount_cents: 4860,
      category: 'alimentacao',
      status: 'confirmed',
      issued_at: '2026-06-17',
    });
    await insertReceipt(report.id, {
      page_number: 2,
      amount_cents: 4860,
      category: 'alimentacao',
      status: 'duplicate',
      issued_at: '2026-06-17',
    });

    const { workbook } = await loadWorkbook(report.id);
    const sheet = workbook.getWorksheet('Resumo');

    // A ordem e cronologica; ambos tem a mesma data, entao a ordem entre
    // eles segue o id (desempate estavel) — a duplicata e a segunda linha.
    expect(sheet.getCell('D3').value).toMatch(/Duplicata/);
    expect(sheet.getCell('F3').value).toBe(1);
  });

  it('relatorio sem comprovantes gera planilha valida com total zero', async () => {
    const report = await insertReport();

    const { response, workbook } = await loadWorkbook(report.id);

    expect(response.status).toBe(200);
    const sheet = workbook.getWorksheet('Resumo');
    // Sem linha de dados, o total cai logo na linha seguinte ao cabecalho.
    expect(sheet.getCell('D3').value).toBe('TOTAL');
    expect(sheet.getCell('E3').value).toBe(0);
  });

  it('retorna 404 para relatorio inexistente', async () => {
    const response = await requestBinary(
      'GET',
      '/api/reports/999999/export.xlsx',
    );

    expect(response.status).toBe(404);
  });
});
