'use strict';

const {
  insertReport,
  insertReceipt,
  currentUser,
  findSessions,
  updateColumnDirectly,
} = require('../orchestrator');

/**
 * As colunas de hash tem folga para um algoritmo de saida maior que o SHA-256:
 * 128 caracteres e o SHA-512 em hex. Com `varchar(64)` a escrita abaixo falha
 * com "value too long".
 */
describe('colunas de hash', () => {
  it('aceitam um hash de 128 caracteres', async () => {
    const [session] = await findSessions(currentUser().id);
    const receipt = await insertReceipt((await insertReport()).id);
    const sha512 = 'a'.repeat(128);

    await expect(
      updateColumnDirectly('sessions', session.id, 'token_hash', sha512),
    ).resolves.toBeDefined();
    await expect(
      updateColumnDirectly('receipts', receipt.id, 'file_hash', sha512),
    ).resolves.toBeDefined();
  });
});
