'use strict';

const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const {
  requestBinary,
  insertReport,
  insertReceipt,
  insertMerchant,
} = require('../../orchestrator');
const { evaluateSum, findRow } = require('../../helpers/xlsx-formula');

async function loadWorkbook(reportId) {
  const response = await requestBinary(
    'GET',
    `/api/reports/${reportId}/export.xlsx`,
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(response.buffer);
  return { response, workbook };
}

/** Um confirmado completo; sem os tres campos o comprovante nao entraria. */
function confirmed(overrides) {
  return { status: 'confirmed', category: 'alimentacao', ...overrides };
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

  it('cria uma aba por tipo com lancamento, na ordem do enum', async () => {
    const report = await insertReport();
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 1,
        category: 'transporte',
        issued_at: '2026-06-19',
        amount_cents: 2436,
      }),
    );
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 2,
        category: 'alimentacao',
        issued_at: '2026-06-20',
        amount_cents: 3760,
      }),
    );

    const { workbook } = await loadWorkbook(report.id);

    // Ordem do enum, nao do valor nem da data: dois relatorios da mesma
    // pessoa precisam sair com o mesmo layout para poderem ser comparados.
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Resumo',
      'Alimentação',
      'Transporte',
    ]);
  });

  it('a aba do tipo grava data de verdade e valor com formato pt-BR', async () => {
    const report = await insertReport();
    await insertReceipt(
      report.id,
      confirmed({ issued_at: '2026-06-19', amount_cents: 3760 }),
    );

    const { workbook } = await loadWorkbook(report.id);
    const sheet = workbook.getWorksheet('Alimentação');

    expect(sheet.getCell('A1').value).toBe('Data');
    expect(sheet.getCell('A2').value).toEqual(new Date(Date.UTC(2026, 5, 19)));
    expect(sheet.getCell('A2').numFmt).toBe('DD/MM/YYYY');
    expect(sheet.getCell('D2').value).toBe(37.6);
    // [$R$-416] e o codigo de moeda pt-BR do Excel — sem ele o separador
    // segue o locale de quem abre o arquivo.
    expect(sheet.getCell('D2').numFmt).toBe('[$R$-416] #,##0.00');
  });

  it('o resumo puxa o valor de cada tipo da aba daquele tipo', async () => {
    const report = await insertReport();
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 1,
        issued_at: '2026-06-19',
        amount_cents: 3760,
      }),
    );
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 2,
        issued_at: '2026-06-21',
        amount_cents: 5200,
      }),
    );
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 3,
        category: 'combustivel',
        issued_at: '2026-06-20',
        amount_cents: 18000,
      }),
    );

    const { workbook } = await loadWorkbook(report.id);
    const summary = workbook.getWorksheet('Resumo');
    const alimentacao = findRow(summary, 'Alimentação');

    expect(summary.getCell(`B${alimentacao}`).value).toBe(2);
    expect(summary.getCell(`C${alimentacao}`).value).toEqual({
      formula: "SUM('Alimentação'!D2:D3)",
      result: 89.6,
    });
    // A formula e resolvida contra as celulas de verdade: se o intervalo
    // apontar para a aba errada ou para linhas de menos, isto quebra.
    expect(evaluateSum(workbook, 'Resumo', `C${alimentacao}`)).toBe(89.6);
    expect(
      evaluateSum(workbook, 'Resumo', `C${findRow(summary, 'Combustível')}`),
    ).toBe(180);
  });

  it('o total geral e a soma das abas, e sai como formula', async () => {
    const report = await insertReport();
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 1,
        issued_at: '2026-06-19',
        amount_cents: 3760,
      }),
    );
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 2,
        category: 'combustivel',
        issued_at: '2026-06-20',
        amount_cents: 18000,
      }),
    );

    const { workbook } = await loadWorkbook(report.id);
    const summary = workbook.getWorksheet('Resumo');
    const totalRow = findRow(summary, 'TOTAL');

    expect(summary.getCell(`C${totalRow}`).value).toHaveProperty('formula');
    expect(evaluateSum(workbook, 'Resumo', `C${totalRow}`)).toBe(217.6);
    expect(evaluateSum(workbook, 'Resumo', `B${totalRow}`)).toBe(2);

    // O total de cada aba e a mesma conta pelo outro lado — se um dos dois
    // divergir, o arquivo se contradiz sozinho.
    const alimentacao = workbook.getWorksheet('Alimentação');
    expect(
      evaluateSum(workbook, 'Alimentação', `D${findRow(alimentacao, 'TOTAL')}`),
    ).toBe(37.6);
  });

  it('toda formula leva o valor guardado, e ele bate com a conta', async () => {
    const report = await insertReport();
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 1,
        issued_at: '2026-08-02',
        amount_cents: 16500,
      }),
    );
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 2,
        issued_at: '2026-08-03',
        amount_cents: 2850,
      }),
    );
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 3,
        category: 'combustivel',
        issued_at: '2026-08-08',
        amount_cents: 22549,
      }),
    );

    const { response, workbook } = await loadWorkbook(report.id);

    // Sem o valor guardado, a pre-visualizacao do WhatsApp e do Drive abria
    // a planilha com os totais em branco.
    const formulas = [];
    workbook.eachSheet((sheet) => {
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          if (cell.value && typeof cell.value.formula === 'string') {
            formulas.push({ sheet: sheet.name, cell });
          }
        });
      });
    });

    // O TOTAL de cada uma das duas abas de tipo; no resumo, o valor de cada
    // tipo e o TOTAL geral em quantidade e em valor.
    expect(formulas).toHaveLength(6);

    for (const { sheet, cell } of formulas) {
      expect(cell.value.result).toBe(
        evaluateSum(workbook, sheet, cell.address),
      );
    }

    const zip = await JSZip.loadAsync(response.buffer);
    const workbookXml = await zip.file('xl/workbook.xml').async('string');
    expect(workbookXml).toMatch(/<calcPr[^>]*fullCalcOnLoad="1"/);
  });

  it('traz a cidade do emitente na coluna Cidade', async () => {
    const report = await insertReport();
    const merchant = await insertMerchant({
      name: 'CEA COMERCIO DE ALIMENTOS',
      city: 'Fortaleza/CE',
    });

    await insertReceipt(
      report.id,
      confirmed({
        issued_at: '2026-08-02',
        amount_cents: 16500,
        merchant_id: merchant.id,
      }),
    );

    const { workbook } = await loadWorkbook(report.id);
    const sheet = workbook.getWorksheet('Alimentação');

    expect(sheet.getRow(1).values.slice(1)).toEqual([
      'Data',
      'Local',
      'Cidade',
      'Valor (R$)',
    ]);

    expect(sheet.getCell('B2').value).toBe('CEA COMERCIO DE ALIMENTOS');
    expect(sheet.getCell('C2').value).toBe('Fortaleza/CE');
  });

  it('deixa a Cidade vazia quando o emitente nao tem endereco lido', async () => {
    const report = await insertReport();
    await insertReceipt(
      report.id,
      confirmed({ issued_at: '2026-06-19', amount_cents: 3760 }),
    );

    const { workbook } = await loadWorkbook(report.id);

    // Recibo manuscrito costuma nao trazer endereco legivel, e inventar
    // qualquer coisa ali seria pior que a celula em branco.
    expect(workbook.getWorksheet('Alimentação').getCell('C2').value).toBe('');
  });

  it('a planilha sai formatada, nao so preenchida', async () => {
    const report = await insertReport();
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 1,
        issued_at: '2026-06-19',
        amount_cents: 3760,
      }),
    );
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 2,
        issued_at: '2026-06-20',
        amount_cents: 5200,
      }),
    );

    const { workbook } = await loadWorkbook(report.id);
    const sheet = workbook.getWorksheet('Alimentação');

    // Cabecalho branco sobre azul, com borda: e o layout da planilha manual
    // que este projeto substitui, e quem confere ja sabe onde olhar nele.
    expect(sheet.getCell('A1').font).toMatchObject({
      bold: true,
      color: { argb: 'FFFFFFFF' },
    });
    expect(sheet.getCell('A1').fill).toMatchObject({
      fgColor: { argb: 'FF1F3864' },
    });
    expect(sheet.getCell('A1').border).toBeDefined();

    // Zebra na segunda linha de dado: e o que permite seguir uma linha larga
    // da data ate o valor sem escorregar para a linha de cima.
    expect(sheet.getCell('A3').fill).toMatchObject({
      fgColor: { argb: 'FFF2F2F2' },
    });
    // O exceljs devolve `{ pattern: 'none' }` na celula sem preenchimento, e
    // nao `undefined`: a assercao e sobre nao haver fundo solido.
    expect(sheet.getCell('A2').fill?.pattern).not.toBe('solid');

    // Cabecalho congelado e filtro: um lote de 30 cupons passa da altura da
    // tela, e sem isso a coluna de valor fica sem titulo ao rolar.
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.autoFilter).toBeDefined();

    // A linha de TOTAL e mesclada ate a coluna do valor.
    const totalRow = findRow(sheet, 'TOTAL');
    expect(sheet.getCell(`A${totalRow}`).isMerged).toBe(true);
    expect(sheet.getColumn(2).width).toBeGreaterThan(20);
  });

  it('so entra confirmado; o resto e contado fora da prestacao', async () => {
    const report = await insertReport();
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 1,
        issued_at: '2026-06-19',
        amount_cents: 3760,
      }),
    );
    await insertReceipt(report.id, {
      page_number: 2,
      status: 'needs_review',
      issued_at: '2026-06-20',
      amount_cents: 1500,
    });
    await insertReceipt(report.id, {
      page_number: 3,
      status: 'duplicate',
      category: 'alimentacao',
      issued_at: '2026-06-19',
      amount_cents: 3760,
    });

    const { workbook } = await loadWorkbook(report.id);
    const summary = workbook.getWorksheet('Resumo');

    // A duplicata tem o mesmo tipo do confirmado e mesmo assim nao pode
    // aparecer na aba dele — seria pagar duas vezes o mesmo almoco. A aba tem
    // uma linha de dado so, entao o TOTAL vem logo na linha 3.
    const alimentacao = workbook.getWorksheet('Alimentação');
    expect(findRow(alimentacao, 'TOTAL')).toBe(3);
    expect(evaluateSum(workbook, 'Alimentação', 'D3')).toBe(37.6);
    expect(
      evaluateSum(workbook, 'Resumo', `C${findRow(summary, 'TOTAL')}`),
    ).toBe(37.6);

    const revisao = findRow(summary, 'Aguardando revisao');
    expect(summary.getCell(`B${revisao}`).value).toBe(1);
    expect(summary.getCell(`C${revisao}`).value).toBe(15);
    expect(summary.getCell(`B${findRow(summary, 'Duplicata')}`).value).toBe(1);
  });

  it('confirmado sem categoria cai no grupo "Sem categoria"', async () => {
    const report = await insertReport();
    // A API nao deixa confirmar sem categoria; escrita direta no banco deixa,
    // e a exportacao nao pode se perder por causa disso. `nao_classificado`
    // e o mesmo caso: ausencia de decisao, nao um tipo de despesa.
    await insertReceipt(report.id, {
      page_number: 1,
      status: 'confirmed',
      category: null,
      issued_at: '2026-06-19',
      amount_cents: 1500,
    });
    await insertReceipt(report.id, {
      page_number: 2,
      status: 'confirmed',
      category: 'nao_classificado',
      issued_at: '2026-06-20',
      amount_cents: 2500,
    });

    const { workbook } = await loadWorkbook(report.id);
    const summary = workbook.getWorksheet('Resumo');

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Resumo',
      'Sem categoria',
    ]);
    expect(summary.getCell(`B${findRow(summary, 'Sem categoria')}`).value).toBe(
      2,
    );
    // O grupo nao pode ficar fora do total so por nao ter tipo — foi assim
    // que a soma dos tipos deixou de fechar com o total geral.
    expect(
      evaluateSum(workbook, 'Resumo', `C${findRow(summary, 'TOTAL')}`),
    ).toBe(40);
  });

  it('relatorio sem confirmado gera planilha valida com total zero', async () => {
    const report = await insertReport({ title: 'Viagem sem revisao' });
    await insertReceipt(report.id, {
      status: 'needs_review',
      amount_cents: 1500,
    });

    const { response, workbook } = await loadWorkbook(report.id);

    expect(response.status).toBe(200);
    const summary = workbook.getWorksheet('Resumo');

    expect(workbook.worksheets).toHaveLength(1);
    expect(summary.getCell('A1').value).toBe('Viagem sem revisao');
    // Zero literal, nao formula: SUM sobre intervalo vazio abriria com #REF!.
    expect(summary.getCell(`C${findRow(summary, 'TOTAL')}`).value).toBe(0);
    expect(
      summary.getCell(`B${findRow(summary, 'Aguardando revisao')}`).value,
    ).toBe(1);
  });
});
