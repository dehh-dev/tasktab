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
  - `updated_at` e mantido pelo trigger `set_updated_at` em toda tabela que o
    tem (as seis da prestacao de contas e de acesso, e sete do RPA), com teste
    em `tests/db/updated-at.test.js`. **Nao volte a setar a coluna num model.**
    Tabela nova com `updated_at` entra na lista do teste.
  - `tasks_title_not_blank` complementa a validacao da aplicacao.
- Remover valor de enum exige recriar o tipo: converta as linhas antes, e
  prove `up` e `down` de verdade com `runMigration` e `migrationsFrom`, como
  `tests/db/expense-category.test.js`. Reverter so a migration do meio quebra a
  ordem que o `node-pg-migrate` confere; o teste desfaz da alvo ate a ultima e
  reaplica num `finally`.
- Mudou um enum? Atualize o espelho em `web/src/constants.js` e, se for
  categoria, os rotulos de `src/services/export/labels.js`. Os enums do RPA
  entram no espelho com a interface (issue 43).

## RPA (`rpa_*`, issue 36)

As garantias moram no banco, com teste em `tests/db/rpa-schema.test.js`,
cada recusa conferida pelo nome da constraint:

- **Dia pago uma vez so:** `rpa_payment_days_paid_once` e unico por pessoa,
  dia e parte (`daily`, `extras`) entre as linhas nao anuladas. Cancelar o RPA
  anula os dias dele pelo trigger `rpa_payments_void_days_on_cancel` — no
  banco, para valer tambem por psql. `correction` (dia pago cujo ponto mudou)
  fica fora do unico e pode ser negativa.
- **O que um pagamento leva de cada dia vai em 1/1920 de centavo**
  (`value_subcents`, `bigint`): diaria/240 e diaria/320 por minuto de extra
  nao fecham em centavo, e o arredondamento e so no total. Todo o resto e
  centavo `integer`.
- `rpa_payments_gross_adds_up`: bruto = liquido + INSS + IRRF, no centavo.
  Codigo e numero do RPA sao unicos so entre os nao cancelados (indice
  parcial), para reemitir depois de cancelar.
- `rpa_rates_no_overlap`: vigencias da mesma funcao nao se sobrepoem, por
  `EXCLUDE USING gist` — por isso a migration cria o `btree_gist`.
- `rpa_workers` -> `rpa_payments` e `RESTRICT`: apagar lancamento com RPA
  emitido e recusado pelo banco.
- `rpa_banks` e `rpa_tax_tables` sao **sementes publicas** da migration
  `seed-rpa-banks-and-taxes` (lista do Banco Central; INSS e IRRF conferidos na
  Receita). O `clearDatabase` dos testes nao as trunca. Tabela de imposto nova
  e linha nova numa migration nova: o IRRF vale pela maior `starts_on` ate a
  data, e o RPA emitido guarda o id da que usou.
- `rpa_files` divide o diretorio de upload com `receipts`: a retencao conta as
  duas tabelas (`REFERENCE_COUNTERS` em `retention.service.js`). Tabela nova
  que grave ali entra na lista. Apagar lancamento leva `rpa_files` em cascata
  — levante os arquivos **antes**, como no `report.destroy`.
