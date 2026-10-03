# Banco: models, migrations e garantias

Este arquivo mora aqui, e nao em `migrations/`, porque o `node-pg-migrate`
tenta carregar como migration todo arquivo daquela pasta: um `CLAUDE.md` ali
derrubou o `npm test`, e derrubaria o `npm run dev` e o CI.

- Crie com `npm run migrations:create -- nome`. `migrations:up` so contra
  `env.development`; o banco de teste recebe as migrations sozinho, no
  `tests/global-setup.js`.
- Migrations **nao** rodam da imagem de producao: `node-pg-migrate` e
  devDependency, e aplicar migration e passo separado do pipeline.
- O que precisa valer para **toda** escrita mora no banco, nao no model — o
  ponto e cobrir tambem seed, psql e migration:
  - `updated_at` e mantido pelo trigger `set_updated_at` nas seis tabelas que
    o tem (tasks, reports, receipts, merchants, users, sessions), com teste em
    `tests/db/updated-at.test.js`. **Nao volte a setar a coluna num model.**
  - `tasks_title_not_blank` complementa a validacao da aplicacao.
- Remover valor de enum exige recriar o tipo: converta as linhas antes, e
  prove `up` e `down` de verdade com `runMigration` e `migrationsFrom`, como
  `tests/db/expense-category.test.js`. Reverter so a migration do meio quebra a
  ordem que o `node-pg-migrate` confere; o teste desfaz da alvo ate a ultima e
  reaplica num `finally`.
- Mudou um enum? Atualize o espelho em `web/src/constants.js` e, se for
  categoria, os rotulos de `src/services/export/labels.js`.
