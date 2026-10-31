'use strict';

const {
  insertTask,
  insertReport,
  insertReceipt,
  insertMerchant,
  insertRow,
  insertRpaCompany,
  insertRpaLaunch,
  insertRpaWorker,
  insertRpaPayment,
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
  ['rpa_companies', () => insertRpaCompany(), 'name', 'Depois'],
  ['rpa_launches', () => insertRpaLaunch(), 'development', 'Depois'],
  [
    'rpa_rates',
    async () =>
      insertRow('rpa_rates', {
        launch_id: (await insertRpaLaunch()).id,
        role: 'Assistente Administrativo',
        starts_on: '2026-10-01',
        ends_on: '2026-10-31',
        daily_cents: 13000,
      }),
    'daily_cents',
    14000,
  ],
  ['rpa_workers', () => insertRpaWorker(), 'name', 'Depois'],
  [
    'rpa_days',
    async () =>
      insertRow('rpa_days', {
        worker_id: (await insertRpaWorker()).id,
        work_date: '2026-10-15',
        quantity: 0,
      }),
    'note',
    'faltou',
  ],
  ['rpa_payments', () => insertRpaPayment(), 'payment_date', '2026-10-22'],
  [
    'rpa_files',
    async () =>
      insertRow('rpa_files', {
        launch_id: (await insertRpaLaunch()).id,
        kind: 'ctps',
        file_hash: 'a'.repeat(64),
        file_path: `${'a'.repeat(64)}.pdf`,
        content_type: 'application/pdf',
        byte_size: 1024,
      }),
    'side',
    'front',
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
