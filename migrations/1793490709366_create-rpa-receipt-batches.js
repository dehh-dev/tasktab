'use strict';

/**
 * O envio dos recibos assinados (issue 42): o PDF escaneado que o financeiro
 * devolve, uma pagina por pessoa. A leitura (texto e OCR) roda na fila, fora
 * da requisicao; esta linha e o que a tela acompanha ate o resultado.
 *
 * O PDF fica no diretorio de upload pelo SHA-256, como o comprovante e os
 * documentos: a retencao conta esta tabela tambem.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createType('rpa_batch_status', [
    'pending',
    'processing',
    'done',
    'failed',
  ]);

  pgm.createTable('rpa_receipt_batches', {
    id: 'id',
    launch_id: {
      type: 'integer',
      notNull: true,
      references: 'rpa_launches',
      onDelete: 'CASCADE',
    },
    // O n-esimo pagamento do lancamento: os recibos voltam por pagamento.
    payment_number: { type: 'smallint', notNull: true },
    file_hash: { type: 'varchar(128)', notNull: true },
    file_path: { type: 'text', notNull: true },
    page_count: { type: 'integer', notNull: true },
    status: { type: 'rpa_batch_status', notNull: true, default: 'pending' },
    // Quem casou, quem faltou, pagina sem pessoa, nome e valor diferentes.
    // So existe quando `done`.
    result: { type: 'jsonb' },
    // Mensagem publica da falha, sem dado de ninguem.
    error: { type: 'varchar(255)' },
    created_by: {
      type: 'integer',
      references: 'users',
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
  pgm.addConstraint('rpa_receipt_batches', 'rpa_receipt_batches_number', {
    check: 'payment_number >= 1',
  });
  pgm.addConstraint('rpa_receipt_batches', 'rpa_receipt_batches_pages', {
    check: 'page_count >= 1',
  });
  pgm.addConstraint('rpa_receipt_batches', 'rpa_receipt_batches_result', {
    check: "(status = 'done') = (result IS NOT NULL)",
  });
  pgm.createIndex('rpa_receipt_batches', 'launch_id');
  pgm.createIndex('rpa_receipt_batches', 'file_hash');
  pgm.createTrigger(
    'rpa_receipt_batches',
    'rpa_receipt_batches_set_updated_at',
    {
      when: 'BEFORE',
      operation: 'UPDATE',
      level: 'ROW',
      function: 'set_updated_at',
    },
  );
};

exports.down = (pgm) => {
  pgm.dropTable('rpa_receipt_batches');
  pgm.dropType('rpa_batch_status');
};
