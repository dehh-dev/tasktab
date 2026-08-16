'use strict';

exports.shorthands = undefined;

const TABLES = ['merchants', 'reports', 'receipts'];

exports.up = (pgm) => {
  pgm.createType('expense_category', [
    'alimentacao',
    'combustivel',
    'estacionamento',
    'lavanderia',
    'transporte',
    'hospedagem',
    'outros',
    'nao_classificado',
  ]);

  pgm.createType('receipt_status', [
    'pending',
    'processing',
    'needs_review',
    'confirmed',
    'duplicate',
    'failed',
  ]);

  pgm.createType('extraction_source', ['qr', 'text', 'ocr', 'manual']);

  // O backlog previa `reports.status` sem definir o enum. Duas fases bastam
  // para o fluxo: em preenchimento e fechada para envio.
  pgm.createType('report_status', ['open', 'closed']);

  pgm.createTable('merchants', {
    id: 'id',
    // So digitos: a mascara e coisa de interface. 14 e o tamanho fixo do CNPJ.
    cnpj: { type: 'varchar(14)', notNull: true, unique: true },
    name: { type: 'varchar(255)', notNull: true },
    default_category: {
      type: 'expense_category',
      notNull: true,
      default: 'nao_classificado',
    },
    city: { type: 'varchar(255)' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createTable('reports', {
    id: 'id',
    title: { type: 'varchar(255)', notNull: true },
    period_start: { type: 'date', notNull: true },
    period_end: { type: 'date', notNull: true },
    // Dinheiro e inteiro em centavos. Somar float produziu
    // 219.98000000000002 na conferencia manual desta prestacao de contas.
    advance_cents: { type: 'integer', notNull: true, default: 0 },
    status: { type: 'report_status', notNull: true, default: 'open' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createTable('receipts', {
    id: 'id',
    report_id: {
      type: 'integer',
      notNull: true,
      references: 'reports',
      onDelete: 'CASCADE',
    },
    // Nulo ate a extracao identificar o emitente.
    merchant_id: {
      type: 'integer',
      references: 'merchants',
      onDelete: 'SET NULL',
    },
    file_path: { type: 'text', notNull: true },
    file_hash: { type: 'varchar(64)', notNull: true },
    page_number: { type: 'integer', notNull: true },
    issued_at: { type: 'date' },
    amount_cents: { type: 'integer' },
    category: { type: 'expense_category' },
    access_key: { type: 'varchar(44)' },
    status: { type: 'receipt_status', notNull: true, default: 'pending' },
    extraction_source: { type: 'extraction_source' },
    confidence: { type: 'numeric(5,4)' },
    raw_text: { type: 'text' },
    // Auto-referencia: aponta para o receipt que este duplica.
    duplicate_of_id: {
      type: 'integer',
      references: 'receipts',
      onDelete: 'SET NULL',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.addConstraint('reports', 'reports_period_in_order', {
    check: 'period_end >= period_start',
  });
  pgm.addConstraint('reports', 'reports_advance_not_negative', {
    check: 'advance_cents >= 0',
  });
  pgm.addConstraint('reports', 'reports_title_not_blank', {
    check: "btrim(title) <> ''",
  });

  // amount_cents e nulo enquanto a extracao nao rodou, entao a checagem so
  // vale quando ha valor.
  pgm.addConstraint('receipts', 'receipts_amount_not_negative', {
    check: 'amount_cents IS NULL OR amount_cents >= 0',
  });
  pgm.addConstraint('receipts', 'receipts_page_number_positive', {
    check: 'page_number >= 1',
  });
  // Barra reprocessar a mesma pagina do mesmo arquivo no mesmo relatorio.
  pgm.addConstraint('receipts', 'receipts_unique_page_per_file', {
    unique: ['report_id', 'file_hash', 'page_number'],
  });

  // Casa com o ORDER BY da listagem (`issued_at`, `page_number` como
  // desempate). Indice de coluna unica nao serve para ordenacao de duas
  // colunas — no tasktab isso ja valeu 2,9 ms -> 0,06 ms na lista de tarefas.
  // ASC no Postgres ja e NULLS LAST, que e a ordem que a listagem quer.
  pgm.createIndex('receipts', ['report_id', 'issued_at', 'page_number'], {
    name: 'receipts_report_issued_page_index',
  });
  pgm.createIndex('receipts', 'status');
  pgm.createIndex('receipts', 'merchant_id');

  // Reaproveita a funcao criada em add-updated-at-trigger: a garantia de
  // updated_at e do banco, e nao do model.
  for (const table of TABLES) {
    pgm.createTrigger(table, `${table}_set_updated_at`, {
      when: 'BEFORE',
      operation: 'UPDATE',
      level: 'ROW',
      function: 'set_updated_at',
    });
  }
};

exports.down = (pgm) => {
  // dropTable leva junto triggers, indices e constraints. Os tipos, nao.
  pgm.dropTable('receipts');
  pgm.dropTable('reports');
  pgm.dropTable('merchants');

  pgm.dropType('report_status');
  pgm.dropType('extraction_source');
  pgm.dropType('receipt_status');
  pgm.dropType('expense_category');
};
