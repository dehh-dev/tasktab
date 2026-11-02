'use strict';

/**
 * O financeiro manda um RPCI por pessoa, e cada um volta assinado no seu
 * proprio PDF (decisao de 2026-11-01). O envio passa a aceitar varios PDFs:
 * `file_hash`/`file_path` continuam sendo o PDF que a leitura percorre (os
 * enviados juntos, na ordem), e `sources` guarda cada arquivo como veio, com
 * a faixa de paginas dele.
 *
 * O recibo de uma pagina so vai para a pessoa como veio, sem copiar a pagina:
 * a assinatura digital (gov.br) vale para o arquivo inteiro e nao sobrevive a
 * uma copia. A retencao conta os arquivos de `sources` tambem.
 *
 * Envio anterior fica com `[]`: a leitura trata o PDF dele como a fonte unica.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('rpa_receipt_batches', {
    sources: { type: 'jsonb', notNull: true, default: '[]' },
  });
  pgm.addConstraint('rpa_receipt_batches', 'rpa_receipt_batches_sources', {
    check: "jsonb_typeof(sources) = 'array'",
  });
  pgm.createIndex('rpa_receipt_batches', 'sources', { method: 'gin' });
};

exports.down = (pgm) => {
  pgm.dropIndex('rpa_receipt_batches', 'sources', { method: 'gin' });
  pgm.dropConstraint('rpa_receipt_batches', 'rpa_receipt_batches_sources');
  pgm.dropColumns('rpa_receipt_batches', ['sources']);
};
