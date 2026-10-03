'use strict';

const {
  request,
  insertReport,
  insertReceipt,
  insertMerchant,
  updateColumnDirectly,
} = require('../../orchestrator');
const { checkDigit } = require('../../../src/services/extraction/access-key');
const { LEVELS, RULE_LEVEL } = require('../../../src/services/validation');

const CHAVE = '52260626048802000165650010001631601303284889';

/**
 * Uma chave que fecha o DV, com UF, mes, numero da nota e tipo de emissao
 * escolhidos: o resto e o do cupom do caso-base.
 */
function chave({
  uf = '23',
  aamm = '2608',
  numero = '000163160',
  tipo = '1',
} = {}) {
  const cnpj = '26048802000165';
  const modelo = '65';
  const serie = '001';
  const codigo = '30328488';
  const sem = `${uf}${aamm}${cnpj}${modelo}${serie}${numero}${tipo}${codigo}`;
  return `${sem}${checkDigit(sem)}`;
}

// Cupom completo: quatro itens que somam 37,60 e o total impresso.
function cupomComItens(total = '37,60') {
  return [
    'MERCEARIA FRANGUINHO NA PANELA LTDA',
    'CNPJ 26.048.802/0001-65',
    '001 REFEICAO COMERCIAL 1 UN 20,00 20,00',
    '002 SUCO NATURAL 2 UN 5,80 11,60',
    '003 SOBREMESA 1 UN 4,00 4,00',
    '004 CAFE 1 UN 2,00 2,00',
    `VALOR TOTAL R$ ${total}`,
  ].join('\n');
}

async function validar(reportId) {
  const response = await request('GET', `/api/reports/${reportId}/validation`);
  return response.body;
}

function porRegra(body, regra) {
  return body.data.filter((alerta) => alerta.rule === regra);
}

describe('GET /api/reports/:id/validation', () => {
  it('relatorio sem comprovantes nao gera alerta', async () => {
    const report = await insertReport();

    const body = await validar(report.id);

    expect(body.data).toEqual([]);
    expect(body.meta).toEqual({
      total: 0,
      pendente: 0,
      decisao: 0,
      atencao: 0,
      verificado: 0,
      informativo: 0,
    });
  });

  it('conta os alertas pela classe do procedimento', async () => {
    const report = await insertReport();
    // Sem data, valor nem categoria: falta algo para a prestacao ficar
    // completa.
    await insertReceipt(report.id, { status: 'needs_review' });

    const body = await validar(report.id);

    expect(porRegra(body, 'incompleto')).toMatchObject([{ level: 'pendente' }]);
    const { total, ...porClasse } = body.meta;
    expect(porClasse.pendente).toBe(1);
    expect(total).toBe(
      Object.values(porClasse).reduce((soma, quantos) => soma + quantos, 0),
    );
  });

  it('toda regra tem uma das cinco classes', () => {
    // Uma regra nova sem classe sairia com `level` indefinido — e a tela,
    // que agrupa pela classe, a esconderia.
    const classes = Object.values(RULE_LEVEL);

    expect(classes.every((level) => LEVELS.includes(level))).toBe(true);
    expect(new Set(classes)).toEqual(new Set(LEVELS));
  });
});

describe('regra: duplicata exata', () => {
  it('a consolidada pela chave sai como verificada, ligando os dois', async () => {
    const report = await insertReport();
    const original = await insertReceipt(report.id, {
      page_number: 1,
      status: 'confirmed',
      issued_at: '2026-06-19',
      amount_cents: 3760,
      category: 'alimentacao',
      access_key: CHAVE,
    });
    const repetido = await insertReceipt(report.id, {
      page_number: 2,
      status: 'duplicate',
      issued_at: '2026-06-19',
      amount_cents: 3760,
      category: 'alimentacao',
      access_key: CHAVE,
    });
    await updateColumnDirectly(
      'receipts',
      repetido.id,
      'duplicate_of_id',
      original.id,
    );

    expect(porRegra(await validar(report.id), 'duplicata_exata')).toEqual([
      expect.objectContaining({
        level: 'verificado',
        receipt_id: repetido.id,
        related_id: original.id,
      }),
    ]);
  });

  it('a marcada a mao nao entra: quem decidiu foi uma pessoa', async () => {
    const report = await insertReport();
    await insertReceipt(report.id, { status: 'duplicate' });

    expect(porRegra(await validar(report.id), 'duplicata_exata')).toEqual([]);
  });
});

describe('regra: valor repetido', () => {
  // Almocos de R$ 48,60 no mesmo restaurante. Dois deles, em 17/06 e 23/06,
  // foram tomados por um so na planilha que originou o projeto, e um
  // lancamento legitimo sumiu.
  async function almocos(...receipts) {
    const report = await insertReport();
    const inserted = [];

    for (const [index, overrides] of receipts.entries()) {
      inserted.push(
        await insertReceipt(report.id, {
          page_number: index + 1,
          status: 'needs_review',
          amount_cents: 4860,
          category: 'alimentacao',
          ...overrides,
        }),
      );
    }

    return { report, receipts: inserted };
  }

  it('avisa nos dois documentos para ninguem apagar', async () => {
    const {
      report,
      receipts: [dia17, dia23],
    } = await almocos(
      { issued_at: '2026-06-17', access_key: chave({ numero: '000163119' }) },
      { issued_at: '2026-06-23', access_key: chave({ numero: '000163160' }) },
    );

    expect(porRegra(await validar(report.id), 'valor_repetido')).toEqual([
      expect.objectContaining({
        level: 'informativo',
        receipt_id: dia17.id,
        related_id: dia23.id,
        message: expect.stringContaining('nao apague'),
      }),
      expect.objectContaining({
        level: 'informativo',
        receipt_id: dia23.id,
        related_id: dia17.id,
        message: expect.stringContaining('nao apague'),
      }),
    ]);
  });

  it('um aviso por comprovante, com os outros documentos de mesmo valor', async () => {
    const {
      report,
      receipts: [primeiro, segundo, terceiro],
    } = await almocos(
      { access_key: chave({ numero: '000163119' }) },
      { access_key: chave({ numero: '000163160' }) },
      { access_key: chave({ numero: '000163284' }) },
    );

    const alertas = porRegra(await validar(report.id), 'valor_repetido');

    expect(alertas.map((alerta) => alerta.receipt_id)).toEqual([
      primeiro.id,
      segundo.id,
      terceiro.id,
    ]);
    expect(alertas[0].message).toContain(
      `dos comprovantes ${segundo.id} e ${terceiro.id}`,
    );
  });

  it('data diferente sem chave nao prova que sao dois documentos', async () => {
    // Pode ser o mesmo recibo enviado duas vezes, com a data lida errado numa
    // delas: um "nao apague" ali seria o alerta errado.
    const { report } = await almocos(
      { issued_at: '2026-06-17' },
      { issued_at: '2026-06-23' },
    );

    expect(porRegra(await validar(report.id), 'valor_repetido')).toEqual([]);
  });

  it('a marcada a mao como duplicata segue avisada se a chave e outra', async () => {
    // Marcar como duplicata tira da soma: e o "apagar" da tela, e foi assim
    // que os R$ 48,60 sumiram.
    const {
      report,
      receipts: [dia17, dia23],
    } = await almocos(
      { access_key: chave({ numero: '000163119' }) },
      { access_key: chave({ numero: '000163160' }), status: 'duplicate' },
    );

    const alertas = porRegra(await validar(report.id), 'valor_repetido');

    expect(alertas.map((alerta) => alerta.receipt_id)).toEqual([
      dia17.id,
      dia23.id,
    ]);
    expect(alertas[1].message).toContain('nem marque como duplicata');
  });

  it('a copia de um documento que segue na soma nao e avisada', async () => {
    const {
      report,
      receipts: [original, , outro],
    } = await almocos(
      { access_key: CHAVE },
      { access_key: CHAVE, status: 'duplicate' },
      { access_key: chave({ numero: '000163119' }) },
    );

    const alertas = porRegra(await validar(report.id), 'valor_repetido');

    expect(alertas.map((alerta) => alerta.receipt_id)).toEqual([
      original.id,
      outro.id,
    ]);
  });

  it('a copia do mesmo documento nao e valor repetido', async () => {
    // Mesma chave e o mesmo cupom: a duplicata exata, que conta uma vez so.
    const { report } = await almocos(
      { access_key: CHAVE },
      { access_key: CHAVE, status: 'duplicate' },
    );

    expect(porRegra(await validar(report.id), 'valor_repetido')).toEqual([]);
  });

  it('valor diferente nao e repetido', async () => {
    const { report } = await almocos(
      { access_key: chave({ numero: '000163119' }) },
      { access_key: chave({ numero: '000163160' }), amount_cents: 4870 },
    );

    expect(porRegra(await validar(report.id), 'valor_repetido')).toEqual([]);
  });
});

describe('regra: soma dos itens', () => {
  it('pega o total digitado com um digito a menos', async () => {
    const report = await insertReport();

    // O erro real: 3,60 onde deveria haver 37,60.
    await insertReceipt(report.id, {
      status: 'needs_review',
      issued_at: '2026-06-19',
      amount_cents: 360,
      category: 'alimentacao',
      raw_text: cupomComItens('3,60'),
    });

    const alertas = porRegra(await validar(report.id), 'soma_itens');

    expect(alertas).toHaveLength(1);
    expect(alertas[0].level).toBe('atencao');
    expect(alertas[0].message).toMatch(/3760/);
  });

  it('fica calado quando os itens batem com o total', async () => {
    const report = await insertReport();

    await insertReceipt(report.id, {
      status: 'needs_review',
      issued_at: '2026-06-19',
      amount_cents: 3760,
      category: 'alimentacao',
      raw_text: cupomComItens('37,60'),
    });

    expect(porRegra(await validar(report.id), 'soma_itens')).toHaveLength(0);
  });

  it('nao dispara quando nao consegue ler os itens', async () => {
    const report = await insertReport();

    // Alarme falso destroi a confianca na conferencia mais rapido do que um
    // erro nao detectado: sem itens legiveis, a regra se cala.
    await insertReceipt(report.id, {
      status: 'needs_review',
      issued_at: '2026-06-19',
      amount_cents: 9999,
      category: 'alimentacao',
      raw_text: 'RECIBO\nValor total 99,99\nAssinatura',
    });

    expect(porRegra(await validar(report.id), 'soma_itens')).toHaveLength(0);
  });
});

describe('regra: periodo', () => {
  it('acusa comprovante de fora do periodo do relatorio', async () => {
    const report = await insertReport({
      period_start: '2026-06-01',
      period_end: '2026-06-30',
    });

    await insertReceipt(report.id, {
      status: 'needs_review',
      issued_at: '2026-05-28',
      amount_cents: 1000,
      category: 'alimentacao',
    });

    const alertas = porRegra(await validar(report.id), 'periodo');

    expect(alertas).toHaveLength(1);
    expect(alertas[0].level).toBe('atencao');
  });

  it('aceita comprovante do primeiro e do ultimo dia', async () => {
    const report = await insertReport({
      period_start: '2026-06-01',
      period_end: '2026-06-30',
    });

    await insertReceipt(report.id, {
      page_number: 1,
      status: 'needs_review',
      issued_at: '2026-06-01',
      amount_cents: 1000,
      category: 'alimentacao',
    });
    await insertReceipt(report.id, {
      page_number: 2,
      status: 'needs_review',
      issued_at: '2026-06-30',
      amount_cents: 1000,
      category: 'alimentacao',
    });

    expect(porRegra(await validar(report.id), 'periodo')).toHaveLength(0);
  });
});

describe('regra: chave de acesso', () => {
  it('acusa chave que nao fecha o digito verificador', async () => {
    const report = await insertReport();
    const quebrada = `${CHAVE.slice(0, 43)}${(Number(CHAVE[43]) + 1) % 10}`;

    // A extracao descarta chave invalida; esta regra existe para o que foi
    // corrigido a mao na revisao.
    await insertReceipt(report.id, {
      status: 'needs_review',
      issued_at: '2026-06-19',
      amount_cents: 3760,
      category: 'alimentacao',
      access_key: quebrada,
    });

    const alertas = porRegra(await validar(report.id), 'chave_acesso');

    expect(alertas).toHaveLength(1);
    expect(alertas[0].level).toBe('atencao');
  });

  it('aceita chave valida', async () => {
    const report = await insertReport();

    await insertReceipt(report.id, {
      status: 'needs_review',
      issued_at: '2026-06-19',
      amount_cents: 3760,
      category: 'alimentacao',
      access_key: CHAVE,
    });

    expect(porRegra(await validar(report.id), 'chave_acesso')).toHaveLength(0);
  });
});

describe('regra: faixa do emitente', () => {
  async function comHistorico(report, merchantId, valores) {
    let pagina = 0;

    for (const valor of valores) {
      pagina += 1;
      await insertReceipt(report.id, {
        page_number: pagina,
        merchant_id: merchantId,
        amount_cents: valor,
        status: 'confirmed',
        issued_at: '2026-06-10',
        category: 'alimentacao',
      });
    }

    return pagina;
  }

  it('acusa valor com um digito a mais', async () => {
    const merchant = await insertMerchant({ default_category: 'alimentacao' });
    const report = await insertReport();
    const pagina = await comHistorico(report, merchant.id, [3760, 4860, 4200]);

    await insertReceipt(report.id, {
      page_number: pagina + 1,
      merchant_id: merchant.id,
      amount_cents: 376000,
      status: 'needs_review',
      issued_at: '2026-06-11',
      category: 'alimentacao',
    });

    const alertas = porRegra(await validar(report.id), 'faixa_emitente');

    expect(alertas).toHaveLength(1);
    expect(alertas[0].level).toBe('atencao');
  });

  it('fica calada sem amostra suficiente do emitente', async () => {
    const merchant = await insertMerchant({ default_category: 'alimentacao' });
    const report = await insertReport();
    const pagina = await comHistorico(report, merchant.id, [3760]);

    await insertReceipt(report.id, {
      page_number: pagina + 1,
      merchant_id: merchant.id,
      amount_cents: 376000,
      status: 'needs_review',
      issued_at: '2026-06-11',
      category: 'alimentacao',
    });

    // Com um comprovante so de historico, qualquer valor parece fora da
    // faixa — e o alerta vira ruido.
    expect(porRegra(await validar(report.id), 'faixa_emitente')).toHaveLength(
      0,
    );
  });
});

describe('alerta nao bloqueia', () => {
  it('o relatorio segue consultavel e somavel com alertas em aberto', async () => {
    const report = await insertReport({
      period_start: '2026-06-01',
      period_end: '2026-06-30',
    });

    await insertReceipt(report.id, {
      status: 'needs_review',
      issued_at: '2026-05-01',
      amount_cents: 5000,
      category: 'alimentacao',
    });

    const body = await validar(report.id);
    expect(body.meta.atencao).toBeGreaterThan(0);

    // Quem assina a prestacao de contas decide. A ferramenta aponta, nao veta.
    const lista = await request('GET', `/api/reports/${report.id}/receipts`);
    expect(lista.status).toBe(200);
    expect(lista.body.meta.total_cents).toBe(5000);
  });
});

describe('regra: adiantamento', () => {
  it('o que esta em revisao ja conta no total comparado ao adiantamento', async () => {
    const report = await insertReport({ advance_cents: 10000 });

    await insertReceipt(report.id, {
      page_number: 1,
      status: 'confirmed',
      issued_at: '2026-06-10',
      amount_cents: 8000,
      category: 'alimentacao',
    });
    // O mesmo total da tela: o valor em revisao soma, e o aviso chega antes
    // de a pessoa confirmar o ultimo comprovante.
    await insertReceipt(report.id, {
      page_number: 2,
      status: 'needs_review',
      issued_at: '2026-06-11',
      amount_cents: 3000,
      category: 'alimentacao',
    });

    const alertas = porRegra(await validar(report.id), 'adiantamento');

    expect(alertas).toHaveLength(1);
    expect(alertas[0].message).toMatch(/1000 centavos/);
  });

  it('adiantamento nao informado nao vira alerta de excesso', async () => {
    // Nulo e "nao informado": a regra dele e outra (PENDENTE), e compara-lo
    // como zero acusaria toda despesa.
    const report = await insertReport({ advance_cents: null });

    await insertReceipt(report.id, {
      status: 'confirmed',
      issued_at: '2026-06-10',
      amount_cents: 8000,
      category: 'alimentacao',
    });

    expect(porRegra(await validar(report.id), 'adiantamento')).toHaveLength(0);
  });

  it('duplicata nao conta no total comparado ao adiantamento', async () => {
    const report = await insertReport({ advance_cents: 10000 });

    await insertReceipt(report.id, {
      page_number: 1,
      status: 'confirmed',
      issued_at: '2026-06-10',
      amount_cents: 8000,
      category: 'alimentacao',
    });
    await insertReceipt(report.id, {
      page_number: 2,
      status: 'duplicate',
      issued_at: '2026-06-10',
      amount_cents: 8000,
      category: 'alimentacao',
    });

    expect(porRegra(await validar(report.id), 'adiantamento')).toHaveLength(0);
  });
});

describe('regra: documentos nao fiscais', () => {
  // Recibo manuscrito, comanda e cupom de conferencia podem ser glosados: o
  // procedimento manda somar a parte e informar quem assina.
  async function relatorio(...receipts) {
    const report = await insertReport();

    for (const [index, overrides] of receipts.entries()) {
      await insertReceipt(report.id, {
        page_number: index + 1,
        status: 'confirmed',
        issued_at: '2026-06-19',
        category: 'alimentacao',
        ...overrides,
      });
    }

    return report;
  }

  it('soma e conta o que nao tem chave de acesso valida', async () => {
    const quebrada = `${CHAVE.slice(0, 43)}${(Number(CHAVE[43]) + 1) % 10}`;
    const report = await relatorio(
      { amount_cents: 2000 },
      // Em revisao tambem conta, como no total da tela.
      { amount_cents: 3000, status: 'needs_review' },
      // Chave que nao fecha o DV nao prova que o documento e NFC-e.
      { amount_cents: 4000, access_key: quebrada },
      { amount_cents: 5000, access_key: CHAVE },
    );

    expect(porRegra(await validar(report.id), 'nao_fiscal')).toEqual([
      {
        rule: 'nao_fiscal',
        level: 'informativo',
        message: expect.stringContaining(
          '3 comprovantes sem chave de acesso valida somam 9000 centavos',
        ),
        count: 3,
        total_cents: 9000,
      },
    ]);
  });

  it('e parte do total da tela: duplicata e comprovante sem valor ficam de fora', async () => {
    const report = await relatorio(
      { amount_cents: 3000, status: 'needs_review' },
      { amount_cents: 3000, status: 'duplicate' },
      { amount_cents: null, status: 'needs_review', category: null },
    );

    const [alerta] = porRegra(await validar(report.id), 'nao_fiscal');
    const { meta } = (
      await request('GET', `/api/reports/${report.id}/receipts`)
    ).body;

    expect(alerta).toMatchObject({ count: 1, total_cents: 3000 });
    expect(alerta.message).toContain(
      '1 comprovante sem chave de acesso valida soma 3000 centavos',
    );
    expect(meta.total_cents).toBe(alerta.total_cents);
  });

  it('relatorio so com NFC-e nao gera o aviso', async () => {
    const report = await relatorio({ amount_cents: 5000, access_key: CHAVE });

    expect(porRegra(await validar(report.id), 'nao_fiscal')).toHaveLength(0);
  });
});

describe('regras da viagem', () => {
  // Viagem a Itapipoca com almocos confirmados de R$ 40,00 no mesmo dia: cada
  // teste muda so o que importa a ele. As duas cidades vieram depois da
  // migration que criou as tabelas, e entram por fora dos `insert*`.
  async function viagem(report, receipts) {
    const { main_city = 'Itapipoca/CE', ...columns } = report;
    const { id } = await insertReport(columns);
    const inserted = [];

    await updateColumnDirectly('reports', id, 'main_city', main_city);

    for (const [index, { issuer_city, ...overrides }] of receipts.entries()) {
      const receipt = await insertReceipt(id, {
        page_number: index + 1,
        status: 'confirmed',
        issued_at: '2026-06-19',
        amount_cents: 4000,
        category: 'alimentacao',
        ...overrides,
      });

      if (issuer_city) {
        await updateColumnDirectly(
          'receipts',
          receipt.id,
          'issuer_city',
          issuer_city,
        );
      }

      inserted.push(receipt);
    }

    return { reportId: id, receipts: inserted };
  }

  describe('categoria Outros', () => {
    it('pede decisao sobre a finalidade, sem repetir na duplicata', async () => {
      const {
        reportId,
        receipts: [outros],
      } = await viagem({}, [
        { category: 'outros' },
        { category: 'alimentacao' },
        { category: 'outros', status: 'duplicate' },
      ]);

      expect(porRegra(await validar(reportId), 'categoria_outros')).toEqual([
        expect.objectContaining({
          level: 'decisao',
          receipt_id: outros.id,
          message: expect.stringContaining('confirme a finalidade'),
        }),
      ]);
    });
  });

  describe('fora da cidade principal', () => {
    it('informa a despesa feita em outra cidade', async () => {
      const {
        reportId,
        receipts: [, , fortaleza],
      } = await viagem({}, [
        { issuer_city: 'Itapipoca/CE' },
        { issuer_city: null },
        { issuer_city: 'Fortaleza/CE' },
        { issuer_city: 'Fortaleza/CE', status: 'duplicate' },
      ]);

      expect(porRegra(await validar(reportId), 'fora_da_cidade')).toEqual([
        expect.objectContaining({
          level: 'informativo',
          receipt_id: fortaleza.id,
          message: expect.stringContaining(
            'Despesa em Fortaleza/CE, fora da cidade principal da viagem (Itapipoca/CE)',
          ),
        }),
      ]);
    });

    it('a mesma cidade escrita de outro jeito nao e outra cidade', async () => {
      // O cupom imprime em caixa alta e sem acento; a cidade principal e
      // digitada a mao, com ou sem a UF.
      const { reportId } = await viagem({ main_city: 'Viamão/RS' }, [
        { issuer_city: 'VIAMAO/RS' },
        { issuer_city: 'Viamao' },
        { issuer_city: 'viamão - rs' },
      ]);

      expect(porRegra(await validar(reportId), 'fora_da_cidade')).toHaveLength(
        0,
      );
    });

    it('mesmo nome em outra UF e outra cidade', async () => {
      const { reportId } = await viagem({ main_city: 'Bom Jesus/PI' }, [
        { issuer_city: 'Bom Jesus/RS' },
      ]);

      expect(porRegra(await validar(reportId), 'fora_da_cidade')).toHaveLength(
        1,
      );
    });

    it('sem cidade principal nao ha o que comparar', async () => {
      const { reportId } = await viagem({ main_city: null }, [
        { issuer_city: 'Fortaleza/CE' },
      ]);

      expect(porRegra(await validar(reportId), 'fora_da_cidade')).toHaveLength(
        0,
      );
    });
  });

  describe('duas cidades no mesmo dia', () => {
    it('um aviso por dia, com as cidades dele', async () => {
      const { reportId } = await viagem({}, [
        { issued_at: '2026-06-14', issuer_city: 'Itapipoca/CE' },
        { issued_at: '2026-06-14', issuer_city: 'Fortaleza/CE' },
        { issued_at: '2026-06-14', issuer_city: 'FORTALEZA/CE' },
        // A mesma cidade escrita de dois jeitos, a duplicata e o comprovante
        // sem cidade nao fazem do dia 15 um dia de duas cidades.
        { issued_at: '2026-06-15', issuer_city: 'Itapipoca/CE' },
        { issued_at: '2026-06-15', issuer_city: 'Itapipoca' },
        {
          issued_at: '2026-06-15',
          issuer_city: 'Salvador/BA',
          status: 'duplicate',
        },
        { issued_at: '2026-06-15', issuer_city: null },
      ]);

      expect(porRegra(await validar(reportId), 'duas_cidades')).toEqual([
        {
          rule: 'duas_cidades',
          level: 'informativo',
          message: expect.stringContaining(
            'Em 2026-06-14 ha despesas em Itapipoca/CE e Fortaleza/CE',
          ),
        },
      ]);
    });
  });

  describe('acima do padrao da categoria', () => {
    function acimaDoPadrao(body) {
      return porRegra(body, 'acima_do_padrao');
    }

    it('pede decisao a partir de tres vezes a mediana dos outros', async () => {
      const {
        reportId,
        receipts: [, , , , caro],
      } = await viagem({}, [
        { amount_cents: 3000 },
        { amount_cents: 4000 },
        { amount_cents: 4000 },
        { amount_cents: 5000 },
        { amount_cents: 12000 },
      ]);

      expect(acimaDoPadrao(await validar(reportId))).toEqual([
        expect.objectContaining({
          level: 'decisao',
          receipt_id: caro.id,
          message: expect.stringContaining(
            'mediana desta categoria na viagem (4000 centavos)',
          ),
        }),
      ]);
    });

    it('abaixo de tres vezes nao avisa', async () => {
      const { reportId } = await viagem({}, [
        { amount_cents: 3000 },
        { amount_cents: 4000 },
        { amount_cents: 4000 },
        { amount_cents: 5000 },
        { amount_cents: 11999 },
      ]);

      expect(acimaDoPadrao(await validar(reportId))).toHaveLength(0);
    });

    it('compara so com a mesma categoria', async () => {
      // O tanque cheio nao e um almoco caro.
      const { reportId } = await viagem({}, [
        { amount_cents: 3000 },
        { amount_cents: 4000 },
        { amount_cents: 4000 },
        { amount_cents: 5000 },
        { amount_cents: 22549, category: 'combustivel' },
      ]);

      expect(acimaDoPadrao(await validar(reportId))).toHaveLength(0);
    });

    it('sem amostra minima da categoria nao avisa', async () => {
      const { reportId } = await viagem({}, [
        { amount_cents: 4000 },
        { amount_cents: 4000 },
        { amount_cents: 50000 },
      ]);

      expect(acimaDoPadrao(await validar(reportId))).toHaveLength(0);
    });

    it('o que esta em revisao nao e julgado nem entra no padrao', async () => {
      // A categoria do que esta em revisao e palpite.
      const { reportId } = await viagem({}, [
        { amount_cents: 4000 },
        { amount_cents: 4000 },
        { amount_cents: 12000 },
        { amount_cents: 4000, status: 'needs_review' },
        { amount_cents: 50000, status: 'needs_review' },
      ]);

      expect(acimaDoPadrao(await validar(reportId))).toHaveLength(0);
    });

    it('Outros nao tem padrao', async () => {
      const { reportId } = await viagem(
        {},
        [3000, 4000, 4000, 5000, 12000].map((amount_cents) => ({
          amount_cents,
          category: 'outros',
        })),
      );

      expect(acimaDoPadrao(await validar(reportId))).toHaveLength(0);
    });
  });

  describe('adiantamento nao informado', () => {
    it('nulo e pendente: sem ele nao ha saldo', async () => {
      const { reportId } = await viagem({ advance_cents: null }, []);

      expect(
        porRegra(await validar(reportId), 'adiantamento_nao_informado'),
      ).toEqual([
        {
          rule: 'adiantamento_nao_informado',
          level: 'pendente',
          message: expect.stringContaining('Adiantamento nao informado'),
        },
      ]);
    });

    it('zero e "nao houve", e nao pede nada', async () => {
      const { reportId } = await viagem({ advance_cents: 0 }, []);

      expect(
        porRegra(await validar(reportId), 'adiantamento_nao_informado'),
      ).toHaveLength(0);
    });
  });
});

describe('regra: combustivel', () => {
  // As duas notas de combustivel da prestacao de Itapipoca, como sairam do
  // OCR: na primeira a linha fecha e o total foi lido com um digito a mais;
  // na segunda o preco saiu sujo e a linha nao fecha.
  const ITAPIPOCA = '39,56 L 5,70 225,49\n.. VALOR TOTAL Ri 2... 2.225,49';
  const FORMOSA = '18.461 L x R$49,97 R$ 91.75\nVALOR TOTAL R$ R$ 91,75';

  async function combustivel(rawText, amountCents, category = 'combustivel') {
    const report = await insertReport();
    await insertReceipt(report.id, {
      status: 'needs_review',
      issued_at: '2026-06-10',
      amount_cents: amountCents,
      category,
      raw_text: rawText,
    });
    return porRegra(await validar(report.id), 'combustivel');
  }

  it('acusa o total lido com um digito a mais', async () => {
    const alertas = await combustivel(ITAPIPOCA, 222549);

    expect(alertas).toHaveLength(1);
    expect(alertas[0].level).toBe('atencao');
    expect(alertas[0].message).toMatch(/22549 centavos/);
  });

  it('cala quando o total bate com litros vezes preco', async () => {
    expect(await combustivel(ITAPIPOCA, 22549)).toHaveLength(0);
  });

  it('linha que nao fecha a propria conta nao acusa o total', async () => {
    // Em Formosa o preco saiu sujo e o total estava certo.
    expect(await combustivel(FORMOSA, 9175)).toHaveLength(0);

    // Quando e o total da linha que sai sujo, ela tambem nao fecha — e nao
    // serve de base para acusar o total do cupom, que estava certo.
    const totalDaLinhaSujo = '18,461 L x R$ 4,97 R$ 81.75\nVALOR TOTAL 91,75';
    expect(await combustivel(totalDaLinhaSujo, 9175)).toHaveLength(0);
  });

  it('so vale em comprovante de combustivel', async () => {
    const mercado = 'AGUA MINERAL 1,500 L 2,49 3,74\nVALOR TOTAL R$ 45,90';

    expect(await combustivel(mercado, 4590, 'alimentacao')).toHaveLength(0);
  });
});

describe('regras: o que a chave de acesso ja diz', () => {
  async function comChave(key, overrides = {}) {
    const report = await insertReport({
      period_start: '2026-06-01',
      period_end: '2026-08-31',
    });
    await insertReceipt(report.id, {
      status: 'needs_review',
      issued_at: '2026-08-02',
      amount_cents: 1500,
      category: 'alimentacao',
      access_key: key,
      ...overrides,
    });
    return validar(report.id);
  }

  it('mes da chave diferente da data lida e erro', async () => {
    // O cupom real: a chave e de agosto, e o OCR leu 02/06 no lugar de 02/08.
    const body = await comChave(chave({ aamm: '2608' }), {
      issued_at: '2026-06-02',
    });

    const alertas = porRegra(body, 'chave_mes');
    expect(alertas).toHaveLength(1);
    expect(alertas[0].level).toBe('atencao');
  });

  it('mes da chave igual ao da data nao acusa', async () => {
    const body = await comChave(chave({ aamm: '2608' }));

    expect(porRegra(body, 'chave_mes')).toHaveLength(0);
  });

  it('emissao em contingencia e aviso', async () => {
    const normal = await comChave(chave({ tipo: '1' }));
    const contingencia = await comChave(chave({ tipo: '9' }));

    expect(porRegra(normal, 'contingencia')).toHaveLength(0);
    expect(porRegra(contingencia, 'contingencia')).toMatchObject([
      { level: 'decisao' },
    ]);
  });

  it('UF da chave diferente da cidade do emitente e aviso', async () => {
    const merchant = await insertMerchant({ city: 'Goiânia/GO' });

    const ceara = await comChave(chave({ uf: '23' }), {
      merchant_id: merchant.id,
    });
    const goias = await comChave(chave({ uf: '52' }), {
      merchant_id: merchant.id,
    });

    expect(porRegra(ceara, 'chave_uf')).toMatchObject([
      { level: 'atencao', message: expect.stringMatching(/CE.*GO/) },
    ]);
    expect(porRegra(goias, 'chave_uf')).toHaveLength(0);
  });
});
