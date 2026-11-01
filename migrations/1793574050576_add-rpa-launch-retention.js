'use strict';

/**
 * Retencao do RPA (decisao de 2026-11-01): um mes depois de encerrado, o
 * lancamento perde os dados pessoais da equipe e os arquivos. Ficam nome, CPF
 * e os valores dos RPAs, o historico do que foi pedido ao financeiro.
 *
 * - `closed_at` e de quando o lancamento foi encerrado: o prazo conta dele, e
 *   nao do `updated_at`, que anda a cada edicao. O trigger o mantem, para
 *   valer tambem por psql e script; o encerrado antes desta migration conta
 *   do ultimo `updated_at`.
 * - `purged_at` e de quando a retencao rodou. Lancamento sem os dados nao
 *   reabre: uma emissao nova sairia com conta e endereco vazios.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('rpa_launches', {
    closed_at: { type: 'timestamptz' },
    purged_at: { type: 'timestamptz' },
  });

  // Sem o trigger do `updated_at`: o preenchimento nao e uma edicao, e o
  // encerrado conta do ultimo `updated_at` de verdade.
  pgm.sql(`
    ALTER TABLE rpa_launches DISABLE TRIGGER rpa_launches_set_updated_at;
    UPDATE rpa_launches SET closed_at = updated_at WHERE status = 'closed';
    ALTER TABLE rpa_launches ENABLE TRIGGER rpa_launches_set_updated_at;
  `);

  pgm.createFunction(
    'rpa_launches_track_closed',
    [],
    { returns: 'trigger', language: 'plpgsql', replace: true },
    `
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'closed' THEN
          NEW.closed_at := NULL;
        ELSIF NEW.closed_at IS NULL THEN
          NEW.closed_at := now();
        END IF;
      ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        NEW.closed_at := CASE WHEN NEW.status = 'closed' THEN now() END;
      END IF;
      RETURN NEW;
    END;
    `,
  );
  pgm.createTrigger('rpa_launches', 'rpa_launches_track_closed', {
    when: 'BEFORE',
    operation: ['INSERT', 'UPDATE'],
    level: 'ROW',
    function: 'rpa_launches_track_closed',
  });

  pgm.addConstraint('rpa_launches', 'rpa_launches_closed_at_matches_status', {
    check: "(status = 'closed') = (closed_at IS NOT NULL)",
  });
  pgm.addConstraint('rpa_launches', 'rpa_launches_purged_stays_closed', {
    check: "purged_at IS NULL OR status = 'closed'",
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint('rpa_launches', 'rpa_launches_purged_stays_closed');
  pgm.dropConstraint('rpa_launches', 'rpa_launches_closed_at_matches_status');
  pgm.dropTrigger('rpa_launches', 'rpa_launches_track_closed');
  pgm.dropFunction('rpa_launches_track_closed', []);
  pgm.dropColumns('rpa_launches', ['closed_at', 'purged_at']);
};
