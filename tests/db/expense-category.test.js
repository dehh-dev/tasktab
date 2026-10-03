'use strict';

const {
  request,
  insertReport,
  insertReceipt,
  insertMerchant,
  updateColumnDirectly,
  enumLabels,
  runMigration,
} = require('../orchestrator');

/**
 * As categorias de despesa sao as cinco do procedimento de prestacao de
 * contas, mais `nao_classificado`, que e ausencia de decisao (issue 40).
 */
describe('categorias de despesa', () => {
  it('sao as cinco do procedimento, mais a ausencia de decisao', async () => {
    expect(await enumLabels('expense_category')).toEqual([
      'alimentacao',
      'combustivel',
      'lavanderia',
      'transporte',
      'outros',
      'nao_classificado',
    ]);
  });

  it('estacionamento nao e mais aceito pelo banco', async () => {
    const receipt = await insertReceipt((await insertReport()).id);

    await expect(
      updateColumnDirectly(
        'receipts',
        receipt.id,
        'category',
        'estacionamento',
      ),
    ).rejects.toThrow(/invalid input value for enum/);
  });
});

// A migration mexe em dado de quem usa: o que era estacionamento vira outros.
// O teste volta o banco para antes dela, grava o estado antigo e a aplica de
// novo — o arranjo so funciona se o `down` devolver o valor ao enum.
describe('migration remove-estacionamento', () => {
  it('o up converte em outros o que era estacionamento', async () => {
    const report = await insertReport();
    let receipt;
    let merchant;

    try {
      runMigration('down');

      receipt = await insertReceipt(report.id, {
        status: 'confirmed',
        category: 'estacionamento',
        issued_at: '2026-06-10',
        amount_cents: 1500,
      });
      merchant = await insertMerchant({ default_category: 'estacionamento' });
    } finally {
      runMigration('up');
    }

    const comprovante = await request('GET', `/api/receipts/${receipt.id}`);
    const emitente = await request('GET', `/api/merchants/${merchant.id}`);

    expect(comprovante.body.data.category).toBe('outros');
    expect(emitente.body.data.default_category).toBe('outros');
  }, 60000);
});
