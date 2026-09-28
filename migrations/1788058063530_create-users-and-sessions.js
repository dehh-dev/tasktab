'use strict';

/**
 * Usuarios, sessoes e o dono do relatorio.
 *
 * Ate aqui a API era aberta: qualquer um que alcancasse a porta listava os
 * relatorios e baixava a imagem de qualquer cupom — que traz CNPJ e, as vezes,
 * CPF de terceiros. Esta migration cria o terreno para fechar isso.
 *
 * `reports.owner_id` nasce **anulavel** de proposito. Nao havia usuarios quando
 * os relatorios existentes foram criados, e inventar um dono para eles seria
 * gravar uma mentira. Relatorio sem dono e legado: so quem tem o escopo
 * `reports:read:any` (admin e auditor) enxerga.
 */

exports.shorthands = undefined;

const TABLES = ['users', 'sessions'];

exports.up = (pgm) => {
  pgm.createType('user_role', ['admin', 'user', 'auditor']);

  pgm.createTable('users', {
    id: 'id',
    name: { type: 'varchar(255)', notNull: true },
    // Guardado sempre em minusculas: a constraint abaixo torna isso garantia do
    // banco, e nao promessa do validator. Sem ela, "Ana@x" e "ana@x" seriam
    // dois cadastros e o login viraria loteria.
    email: { type: 'varchar(255)', notNull: true, unique: true },
    // Formato `scrypt$N$r$p$salt$hash`. Os parametros vao junto do hash para
    // que endurecer o custo depois nao invalide as senhas ja cadastradas.
    password_hash: { type: 'text', notNull: true },
    role: { type: 'user_role', notNull: true, default: 'user' },
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

  pgm.createTable('sessions', {
    id: 'id',
    user_id: {
      type: 'integer',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    // O SHA-256 do token, nunca o token. Quem ler um dump do banco nao
    // consegue se passar por ninguem — e a mesma razao de a senha ser hash.
    token_hash: { type: 'varchar(64)', notNull: true, unique: true },
    expires_at: { type: 'timestamptz', notNull: true },
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

  // O dono do relatorio. SET NULL e nao CASCADE: apagar quem prestou contas
  // nao pode levar embora a prestacao. E a mesma razao pela qual nao existe
  // TTL nos arquivos enviados — o relatorio e evidencia de algo assinado.
  pgm.addColumns('reports', {
    owner_id: {
      type: 'integer',
      references: 'users',
      onDelete: 'SET NULL',
    },
  });

  pgm.addConstraint('users', 'users_name_not_blank', {
    check: "btrim(name) <> ''",
  });
  pgm.addConstraint('users', 'users_email_lowercase', {
    check: 'email = lower(email)',
  });
  pgm.addConstraint('users', 'users_email_not_blank', {
    check: "btrim(email) <> ''",
  });

  pgm.createIndex('sessions', 'user_id');
  // A varredura de sessoes vencidas roda a cada login, filtrando por esta
  // coluna.
  pgm.createIndex('sessions', 'expires_at');
  // Casa com a listagem de relatorios filtrada pelo dono.
  pgm.createIndex('reports', 'owner_id');

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
  pgm.dropIndex('reports', 'owner_id');
  pgm.dropColumns('reports', ['owner_id']);

  // dropTable leva junto triggers, indices e constraints. O tipo, nao.
  pgm.dropTable('sessions');
  pgm.dropTable('users');

  pgm.dropType('user_role');
};
