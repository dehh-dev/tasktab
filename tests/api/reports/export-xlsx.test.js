'use strict';

const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const {
  request,
  requestBinary,
  insertReport,
  insertReceipt,
  insertMerchant,
} = require('../../orchestrator');
const { evaluateCell, findRow } = require('../../helpers/xlsx-formula');
const { checkDigit } = require('../../../src/services/extraction/access-key');
const { LEVELS } = require('../../../src/services/validation');

// As classes como a planilha as escreve: com acento.
const CLASSE = {
  pendente: 'Pendente',
  decisao: 'Decisão',
  atencao: 'Atenção',
  verificado: 'Verificado',
  informativo: 'Informativo',
};

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

/** Uma chave que fecha o DV, de junho de 2026 e do Ceara: documento fiscal. */
function chave(numero = '000163160') {
  const sem = `2326062604880200016565001${numero}130328488`;
  return `${sem}${checkDigit(sem)}`;
}

/** Valor da coluna C da linha com esse rotulo no Resumo, resolvido. */
function resumo(workbook, label, column = 'C') {
  const sheet = workbook.getWorksheet('Resumo');
  return evaluateCell(workbook, 'Resumo', `${column}${findRow(sheet, label)}`);
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

  it('abre com Despesas, Resumo e Observacoes, e as abas por tipo depois', async () => {
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
        issued_at: '2026-06-20',
        amount_cents: 3760,
      }),
    );

    const { workbook } = await loadWorkbook(report.id);

    // As tres do procedimento primeiro. As abas por tipo (issue 29) ficam ao
    // lado, na ordem do enum e nao do valor: dois relatorios da mesma pessoa
    // precisam sair com o mesmo layout para poderem ser comparados.
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Despesas',
      'Resumo',
      'Observações',
      'Alimentação',
      'Táxi-Locomoção',
    ]);
  });

  it('toda formula leva o valor guardado, e ele bate com a conta', async () => {
    const report = await insertReport({ advance_cents: 50000 });
    const fortaleza = await insertMerchant({ city: 'Fortaleza/CE' });

    await insertReceipt(
      report.id,
      confirmed({
        page_number: 1,
        issued_at: '2026-06-02',
        amount_cents: 16500,
        merchant_id: fortaleza.id,
      }),
    );
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 2,
        issued_at: '2026-06-03',
        amount_cents: 2850,
        access_key: chave(),
      }),
    );
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 3,
        category: 'combustivel',
        issued_at: '2026-06-08',
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

    expect(new Set(formulas.map(({ sheet }) => sheet))).toEqual(
      new Set(['Despesas', 'Resumo', 'Alimentação', 'Combustível']),
    );

    for (const { sheet, cell } of formulas) {
      expect(cell.value.result).toEqual(
        evaluateCell(workbook, sheet, cell.address),
      );
    }

    const zip = await JSZip.loadAsync(response.buffer);
    const workbookXml = await zip.file('xl/workbook.xml').async('string');
    expect(workbookXml).toMatch(/<calcPr[^>]*fullCalcOnLoad="1"/);
  });

  it('com o relatorio conferido, o total da tela e o da planilha', async () => {
    const report = await insertReport();
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 1,
        issued_at: '2026-06-19',
        amount_cents: 3760,
      }),
    );
    // A duplicata fica fora dos dois. Durante a revisao a tela soma tambem o
    // que ainda nao foi confirmado; conferido o relatorio, os totais batem.
    await insertReceipt(report.id, {
      page_number: 2,
      status: 'duplicate',
      category: 'alimentacao',
      issued_at: '2026-06-19',
      amount_cents: 3760,
    });

    const { workbook } = await loadWorkbook(report.id);
    const despesas = workbook.getWorksheet('Despesas');
    const planilha = evaluateCell(
      workbook,
      'Despesas',
      `E${findRow(despesas, 'TOTAL GERAL')}`,
    );

    const tela = await request('GET', `/api/reports/${report.id}/receipts`);

    expect(Math.round(planilha * 100)).toBe(tela.body.meta.total_cents);
  });

  it('relatorio sem confirmado gera planilha valida com total zero', async () => {
    const report = await insertReport({ title: 'Viagem sem revisao' });
    await insertReceipt(report.id, {
      status: 'needs_review',
      amount_cents: 1500,
    });

    const { response, workbook } = await loadWorkbook(report.id);

    expect(response.status).toBe(200);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Despesas',
      'Resumo',
      'Observações',
    ]);

    const despesas = workbook.getWorksheet('Despesas');
    const summary = workbook.getWorksheet('Resumo');

    expect(summary.getCell('A1').value).toBe('Viagem sem revisao');
    // Zero literal, nao formula: SUM sobre intervalo vazio abriria com #REF!.
    expect(despesas.getCell(`E${findRow(despesas, 'TOTAL GERAL')}`).value).toBe(
      0,
    );
    expect(resumo(workbook, 'Resultado')).toBe('OK');
    expect(
      summary.getCell(`B${findRow(summary, 'Aguardando revisao')}`).value,
    ).toBe(1);
  });
});

describe('aba Despesas', () => {
  it('traz as cinco colunas do procedimento na ordem, e as de apoio depois', async () => {
    const report = await insertReport();
    const merchant = await insertMerchant({
      name: 'CEA COMERCIO DE ALIMENTOS',
      city: 'Fortaleza/CE',
    });

    await insertReceipt(
      report.id,
      confirmed({
        page_number: 1,
        issued_at: '2026-06-19',
        amount_cents: 3760,
        merchant_id: merchant.id,
        access_key: chave(),
      }),
    );
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 2,
        category: 'transporte',
        issued_at: '2026-06-20',
        amount_cents: 2436,
      }),
    );

    const { workbook } = await loadWorkbook(report.id);
    const sheet = workbook.getWorksheet('Despesas');

    expect(sheet.getRow(1).values.slice(1)).toEqual([
      'Data',
      'Local',
      'Cidade',
      'Tipo',
      'Valor',
      'Documento',
      'Conferência',
    ]);
    expect(sheet.getRow(2).values.slice(1, 7)).toEqual([
      new Date(Date.UTC(2026, 5, 19)),
      'CEA COMERCIO DE ALIMENTOS',
      'Fortaleza/CE',
      'Alimentação',
      37.6,
      'Com chave',
    ]);
    expect(sheet.getCell('A2').numFmt).toBe('DD/MM/YYYY');
    // [$R$-416] e o codigo de moeda pt-BR do Excel — sem ele o separador
    // segue o locale de quem abre o arquivo.
    expect(sheet.getCell('E2').numFmt).toBe('[$R$-416] #,##0.00');

    // Sem chave de acesso o documento nao e fiscal: recibo, comanda e cupom
    // de conferencia podem ser glosados (issue 50).
    expect(sheet.getCell('D3').value).toBe('Táxi/Locomoção');
    expect(sheet.getCell('F3').value).toBe('Sem chave');
  });

  it('um confirmado por linha, em ordem cronologica, e o TOTAL GERAL', async () => {
    const report = await insertReport();
    // Fora de ordem de proposito, e com um em revisao que nao entra.
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 1,
        issued_at: '2026-06-21',
        amount_cents: 5200,
      }),
    );
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 2,
        category: 'combustivel',
        issued_at: '2026-06-19',
        amount_cents: 18000,
      }),
    );
    await insertReceipt(report.id, {
      page_number: 3,
      status: 'needs_review',
      issued_at: '2026-06-20',
      amount_cents: 1500,
    });

    const { workbook } = await loadWorkbook(report.id);
    const sheet = workbook.getWorksheet('Despesas');
    const total = findRow(sheet, 'TOTAL GERAL');

    expect(total).toBe(4);
    expect([sheet.getCell('D2').value, sheet.getCell('D3').value]).toEqual([
      'Combustível',
      'Alimentação',
    ]);
    expect(sheet.getCell(`A${total}`).isMerged).toBe(true);
    expect(sheet.getCell(`E${total}`).value).toHaveProperty('formula');
    expect(evaluateCell(workbook, 'Despesas', `E${total}`)).toBe(232);
  });

  it('a linha que pede atencao ganha cor, e a classe vem escrita ao lado', async () => {
    const report = await insertReport();
    // Outros: a finalidade pede decisao.
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 1,
        category: 'outros',
        issued_at: '2026-06-10',
        amount_cents: 1500,
      }),
    );
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 2,
        issued_at: '2026-06-11',
        amount_cents: 2000,
      }),
    );
    // Fora do periodo do relatorio: provavelmente lido errado.
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 3,
        issued_at: '2026-07-02',
        amount_cents: 3760,
      }),
    );

    const { workbook } = await loadWorkbook(report.id);
    const sheet = workbook.getWorksheet('Despesas');

    // A cor ajuda a achar; quem diz e o texto, e a cor nunca e o unico canal.
    expect(sheet.getCell('G2').value).toBe('Decisão');
    expect(sheet.getCell('A2').fill).toMatchObject({
      fgColor: { argb: 'FFFFF2CC' },
    });
    expect(sheet.getCell('G4').value).toBe('Atenção');
    expect(sheet.getCell('E4').fill).toMatchObject({
      fgColor: { argb: 'FFFCE4D6' },
    });

    // Sem nada a conferir, a linha fica so com a zebra.
    expect(sheet.getCell('G3').value).toBe('');
    expect(sheet.getCell('A3').fill).toMatchObject({
      fgColor: { argb: 'FFF2F2F2' },
    });
  });

  it('sai deitada, na largura da folha, com cabecalho congelado e filtro', async () => {
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
    const sheet = workbook.getWorksheet('Despesas');

    expect(sheet.pageSetup).toMatchObject({
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    });
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.autoFilter).toBe('A1:G3');

    // Cabecalho branco sobre azul, como a planilha manual que este projeto
    // substitui.
    expect(sheet.getCell('A1').font).toMatchObject({
      bold: true,
      color: { argb: 'FFFFFFFF' },
    });
    expect(sheet.getCell('G1').fill).toMatchObject({
      fgColor: { argb: 'FF1F3864' },
    });
  });
});

describe('aba Resumo', () => {
  async function tresDespesas(report) {
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
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 3,
        issued_at: '2026-06-21',
        amount_cents: 5200,
      }),
    );
  }

  it('soma cada tipo a partir de Despesas, por formula', async () => {
    const report = await insertReport();
    await tresDespesas(report);

    const { workbook } = await loadWorkbook(report.id);
    const summary = workbook.getWorksheet('Resumo');
    const alimentacao = findRow(summary, 'Alimentação');

    // COUNTIF e SUMIF sobre a coluna Tipo, como a planilha que a pessoa
    // conferiu em Itapipoca.
    expect(summary.getCell(`B${alimentacao}`).value.formula).toMatch(
      /^COUNTIF\('Despesas'!\$D\$2:\$D\$4,A\d+\)$/,
    );
    expect(resumo(workbook, 'Alimentação', 'B')).toBe(2);
    expect(resumo(workbook, 'Alimentação')).toBe(89.6);
    expect(resumo(workbook, 'Combustível')).toBe(180);
    expect(resumo(workbook, 'Total')).toBe(269.6);

    // Corrigir uma linha de Despesas corrige o Resumo: nada ali e numero
    // repetido, que criaria duas verdades no mesmo arquivo.
    workbook.getWorksheet('Despesas').getCell('E2').value = 100;
    expect(resumo(workbook, 'Alimentação')).toBe(152);
  });

  it('soma cada cidade, sem separar a mesma cidade escrita em outra caixa', async () => {
    const report = await insertReport();
    const itapipoca = await insertMerchant({
      cnpj: '11111111000111',
      city: 'Itapipoca/CE',
    });
    const caixaAlta = await insertMerchant({
      cnpj: '22222222000122',
      city: 'ITAPIPOCA/CE',
    });
    const fortaleza = await insertMerchant({
      cnpj: '33333333000133',
      city: 'Fortaleza/CE',
    });

    const despesas = [
      [itapipoca.id, '2026-06-19', 3760],
      [caixaAlta.id, '2026-06-20', 5200],
      [fortaleza.id, '2026-06-21', 18000],
      [null, '2026-06-22', 1000],
    ];

    for (const [index, [merchantId, issuedAt, amount]] of despesas.entries()) {
      await insertReceipt(
        report.id,
        confirmed({
          page_number: index + 1,
          merchant_id: merchantId,
          issued_at: issuedAt,
          amount_cents: amount,
        }),
      );
    }

    const { workbook } = await loadWorkbook(report.id);
    const summary = workbook.getWorksheet('Resumo');

    // O COUNTIF do Excel nao distingue caixa: uma linha para cada grafia
    // somaria a mesma despesa duas vezes, e a conferencia acusaria.
    expect(() => findRow(summary, 'ITAPIPOCA/CE')).toThrow();
    expect(resumo(workbook, 'Itapipoca/CE', 'B')).toBe(2);
    expect(resumo(workbook, 'Itapipoca/CE')).toBe(89.6);
    expect(resumo(workbook, 'Fortaleza/CE')).toBe(180);
    // Recibo sem endereco legivel nao some do resumo por cidade.
    expect(resumo(workbook, 'Sem cidade')).toBe(10);
    expect(resumo(workbook, 'Soma por cidade')).toBe(279.6);
  });

  it('as quatro somas batem, e a conferencia diz OK', async () => {
    const report = await insertReport();
    await tresDespesas(report);

    const { workbook } = await loadWorkbook(report.id);

    expect(
      [
        'Soma das linhas',
        'Total geral',
        'Soma por tipo',
        'Soma por cidade',
      ].map((label) => resumo(workbook, label)),
    ).toEqual([269.6, 269.6, 269.6, 269.6]);
    expect(resumo(workbook, 'Resultado')).toBe('OK');
  });

  // Cada uma das tres somas comparadas com a das linhas, desfeita por uma
  // edicao a mao que so ela pega.
  it.each([
    // O tipo digitado sem acento sai do SUMIF do tipo.
    ['Soma por tipo', 'D2', 'Alimentacao', 232],
    // A cidade trocada por uma que o resumo nao lista sai do SUMIF da cidade.
    ['Soma por cidade', 'C2', 'Sobral/CE', 232],
    // O total digitado por cima da formula deixa de ser a soma das linhas.
    ['Total geral', 'E5', 999, 999],
  ])(
    'a conferencia diz DIVERGÊNCIA quando "%s" deixa de bater',
    async (soma, celula, valor, esperado) => {
      const report = await insertReport();
      await tresDespesas(report);

      const { workbook } = await loadWorkbook(report.id);
      workbook.getWorksheet('Despesas').getCell(celula).value = valor;

      expect(resumo(workbook, soma)).toBe(esperado);
      expect(resumo(workbook, 'Soma das linhas')).toBe(269.6);
      expect(resumo(workbook, 'Resultado')).toBe('DIVERGÊNCIA');
    },
  );

  it.each([
    [100000, 962.4, 'A devolver'],
    [3760, 0, 'Zerado'],
    [0, -37.6, 'A receber'],
  ])(
    'com adiantamento de %i centavos, saldo %d e "%s"',
    async (advance, saldo, situacao) => {
      const report = await insertReport({ advance_cents: advance });
      await insertReceipt(
        report.id,
        confirmed({ issued_at: '2026-06-19', amount_cents: 3760 }),
      );

      const { workbook } = await loadWorkbook(report.id);

      expect(resumo(workbook, 'Saldo')).toBe(saldo);
      expect(resumo(workbook, 'Situação')).toBe(situacao);
    },
  );

  it('adiantamento nao informado nao vira saldo', async () => {
    // Tratar o nulo como zero diria que a pessoa tem tudo a receber.
    const report = await insertReport({ advance_cents: null });
    await insertReceipt(
      report.id,
      confirmed({ issued_at: '2026-06-19', amount_cents: 3760 }),
    );

    const { workbook } = await loadWorkbook(report.id);
    const summary = workbook.getWorksheet('Resumo');

    expect(summary.getCell(`C${findRow(summary, 'Adiantamento')}`).value).toBe(
      'Não informado',
    );
    expect(summary.getCell(`C${findRow(summary, 'Saldo')}`).value).toBe('—');
  });

  it('os documentos sem chave tem o mesmo numero da conferencia (issue 50)', async () => {
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
        access_key: chave(),
      }),
    );
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 3,
        category: 'transporte',
        issued_at: '2026-06-21',
        amount_cents: 2436,
      }),
    );
    // Chave que nao fecha o DV nao prova que o documento e fiscal.
    const quebrada = chave().replace(/.$/, (digit) =>
      String((Number(digit) + 1) % 10),
    );
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 4,
        issued_at: '2026-06-22',
        amount_cents: 1000,
        access_key: quebrada,
      }),
    );

    const { workbook } = await loadWorkbook(report.id);
    const { body } = await request(
      'GET',
      `/api/reports/${report.id}/validation`,
    );
    const conferencia = body.data.find((alert) => alert.rule === 'nao_fiscal');

    // Com o relatorio todo conferido, a planilha e a tela contam o mesmo.
    expect(conferencia).toMatchObject({ count: 3, total_cents: 7196 });
    expect(resumo(workbook, 'Sem chave', 'B')).toBe(conferencia.count);
    expect(Math.round(resumo(workbook, 'Sem chave') * 100)).toBe(
      conferencia.total_cents,
    );
    expect(resumo(workbook, 'Com chave')).toBe(52);
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
    const despesas = workbook.getWorksheet('Despesas');
    const summary = workbook.getWorksheet('Resumo');

    // A duplicata tem o mesmo tipo do confirmado e mesmo assim nao entra —
    // seria pagar duas vezes o mesmo almoco. Uma linha de dado so, entao o
    // TOTAL GERAL vem logo na linha 3.
    expect(findRow(despesas, 'TOTAL GERAL')).toBe(3);
    expect(evaluateCell(workbook, 'Despesas', 'E3')).toBe(37.6);
    expect(resumo(workbook, 'Total geral')).toBe(37.6);

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

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Despesas',
      'Resumo',
      'Observações',
      'Sem categoria',
    ]);
    expect(resumo(workbook, 'Sem categoria', 'B')).toBe(2);
    // O grupo nao pode ficar fora do total so por nao ter tipo — foi assim
    // que a soma dos tipos deixou de fechar com o total geral.
    expect(resumo(workbook, 'Soma por tipo')).toBe(40);
    expect(resumo(workbook, 'Resultado')).toBe('OK');
  });
});

describe('aba Observações', () => {
  it('traz a conferencia da tela, na classificacao do procedimento', async () => {
    // Adiantamento nao informado: falta algo para a prestacao fechar.
    const report = await insertReport({ advance_cents: null });
    const merchant = await insertMerchant({ name: 'Bomboniere da Praca' });

    await insertReceipt(
      report.id,
      confirmed({
        page_number: 1,
        category: 'outros',
        issued_at: '2026-06-10',
        amount_cents: 20559,
        merchant_id: merchant.id,
      }),
    );
    await insertReceipt(
      report.id,
      confirmed({
        page_number: 2,
        issued_at: '2026-07-02',
        amount_cents: 3760,
      }),
    );

    const { workbook } = await loadWorkbook(report.id);
    const sheet = workbook.getWorksheet('Observações');
    const { body } = await request(
      'GET',
      `/api/reports/${report.id}/validation`,
    );

    expect(sheet.getRow(1).values.slice(1)).toEqual([
      'Classe',
      'Data',
      'Local',
      'Valor',
      'Observação',
    ]);

    // O mesmo texto da tela, agrupado pela classe: as duas nunca contam
    // historias diferentes.
    const linhas = [];
    sheet.eachRow((row, number) => {
      if (number > 1) {
        linhas.push([row.getCell(1).value, row.getCell(5).value]);
      }
    });

    expect(linhas).toEqual(
      LEVELS.flatMap((level) =>
        body.data.filter((alert) => alert.level === level),
      ).map((alert) => [CLASSE[alert.level], alert.message]),
    );
    expect(linhas.map(([classe]) => classe)).toEqual([
      'Pendente',
      'Decisão',
      'Atenção',
      'Informativo',
    ]);

    // O alerta de comprovante traz data, local e valor dele; o do relatorio
    // inteiro, nao tem de onde.
    const decisao = findRow(sheet, 'Decisão');
    expect(sheet.getRow(decisao).values.slice(2, 5)).toEqual([
      new Date(Date.UTC(2026, 5, 10)),
      'Bomboniere da Praca',
      205.59,
    ]);
    expect(sheet.getCell(`B${findRow(sheet, 'Pendente')}`).value).toBeNull();
  });

  it('sem alerta, diz que nao ha observacao', async () => {
    const report = await insertReport();
    await insertReceipt(
      report.id,
      confirmed({
        issued_at: '2026-06-19',
        amount_cents: 3760,
        access_key: chave(),
      }),
    );

    const { workbook } = await loadWorkbook(report.id);

    expect(workbook.getWorksheet('Observações').getCell('A2').value).toBe(
      'Nenhuma observação da conferência.',
    );
  });
});

describe('abas por tipo', () => {
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
    expect(sheet.getCell('D2').numFmt).toBe('[$R$-416] #,##0.00');
  });

  it('o TOTAL de cada aba soma as linhas dela', async () => {
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

    const { workbook } = await loadWorkbook(report.id);
    const alimentacao = workbook.getWorksheet('Alimentação');

    expect(
      evaluateCell(
        workbook,
        'Alimentação',
        `D${findRow(alimentacao, 'TOTAL')}`,
      ),
    ).toBe(89.6);
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

  it('sem emitente cadastrado, Local e Cidade saem do proprio comprovante', async () => {
    const report = await insertReport();
    const receipt = await insertReceipt(
      report.id,
      confirmed({ issued_at: '2026-08-03', amount_cents: 2850 }),
    );
    // O recibo manuscrito revisado a mao: sem CNPJ, nome e cidade como estao
    // no papel.
    await request('PATCH', `/api/receipts/${receipt.id}`, {
      issuer_name: 'Espetinho do Raimundinho',
      issuer_city: 'Itapipoca/CE',
    });

    const { workbook } = await loadWorkbook(report.id);

    for (const [sheet, local, cidade] of [
      ['Alimentação', 'B2', 'C2'],
      ['Despesas', 'B2', 'C2'],
    ]) {
      expect(workbook.getWorksheet(sheet).getCell(local).value).toBe(
        'Espetinho do Raimundinho',
      );
      expect(workbook.getWorksheet(sheet).getCell(cidade).value).toBe(
        'Itapipoca/CE',
      );
    }
  });

  it('a aba sai formatada, nao so preenchida', async () => {
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
});
