'use strict';

const {
  insertReport,
  insertReceipt,
  updateColumnDirectly,
} = require('../orchestrator');

/**
 * O giro da pagina so vale em quarto de volta (issue 43), e a garantia e do
 * banco: vale para toda escrita, inclusive a que nao passa pela API.
 */
describe('rotacao do comprovante', () => {
  it('aceita quarto de volta e recusa o resto', async () => {
    const receipt = await insertReceipt((await insertReport()).id);

    await expect(
      updateColumnDirectly('receipts', receipt.id, 'rotation', 270),
    ).resolves.toBeDefined();
    await expect(
      updateColumnDirectly('receipts', receipt.id, 'rotation', 45),
    ).rejects.toThrow(/receipts_rotation_quarter_turn/);
  });
});
