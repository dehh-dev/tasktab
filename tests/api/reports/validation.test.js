'use strict';

const {
  request,
  insertReport,
  insertReceipt,
  insertMerchant,
} = require('../../orchestrator');

const CHAVE = '52260626048802000165650010001631601303284889';

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
    expect(body.meta).toEqual({ total: 0, erros: 0, avisos: 0 });
  });

  it('retorna 404 para relatorio inexistente', async () => {
    const response = await request('GET', '/api/reports/999999/validation');

    expect(response.status).toBe(404);
  });

  it('separa erro de aviso na contagem', async () => {
    const report = await insertReport();
    await insertReceipt(report.id, { status: 'needs_review' });

    const body = await validar(report.id);

    expect(body.meta.total).toBe(body.meta.erros + body.meta.avisos);
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
    expect(alertas[0].severity).toBe('erro');
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
    expect(alertas[0].severity).toBe('erro');
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
    expect(alertas[0].severity).toBe('erro');
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
    expect(alertas[0].severity).toBe('aviso');
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
    expect(body.meta.erros).toBeGreaterThan(0);

    // Quem assina a prestacao de contas decide. A ferramenta aponta, nao veta.
    const lista = await request('GET', `/api/reports/${report.id}/receipts`);
    expect(lista.status).toBe(200);
    expect(lista.body.meta.total_cents).toBe(5000);
  });
});
