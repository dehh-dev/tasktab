'use strict';

const {
  insertTask,
  insertReport,
  insertReceipt,
  insertMerchant,
  currentUser,
  findSessions,
  updateColumnDirectly,
} = require('../orchestrator');

/**
 * `updated_at` e garantia do banco, e nao do model: o trigger `set_updated_at`
 * cobre tambem seed, psql e migration. Cada escrita abaixo e SQL cru que nao
 * toca na coluna — se ela andou, foi o trigger.
 *
 * Os testes antigos, um por rota de edicao, comparavam a string ISO da
 * resposta com o `Date` que o `pg` devolve, e os dois nunca sao iguais: com os
 * triggers removidos, tres dos quatro continuavam passando.
 */
const TABLES = [
  ['tasks', () => insertTask(), 'title', 'Depois'],
  ['reports', () => insertReport(), 'title', 'Depois'],
  [
    'receipts',
    async () => insertReceipt((await insertReport()).id),
    'raw_text',
    'depois',
  ],
  ['merchants', () => insertMerchant(), 'name', 'Depois'],
  ['users', () => currentUser(), 'name', 'Depois'],
  [
    'sessions',
    async () => (await findSessions(currentUser().id))[0],
    'expires_at',
    new Date(Date.now() + 60 * 60 * 1000),
  ],
];

describe('trigger de updated_at', () => {
  it.each(TABLES)(
    'atualiza o updated_at de %s em escrita fora da API',
    async (table, arrange, column, value) => {
      const row = await arrange();
      const result = await updateColumnDirectly(table, row.id, column, value);

      // O objeto inteiro na comparacao: se falhar, os dois instantes aparecem.
      expect(result).toMatchObject({ moved: true });
    },
  );
});
