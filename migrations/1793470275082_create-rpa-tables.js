'use strict';

/**
 * Modulo RPA (issue 36): o schema inteiro de uma vez, para as etapas
 * seguintes so acrescentarem comportamento.
 *
 * Substitui a planilha `CONTROLE DE DIARIA - <cidade>.xlsb`. O que a planilha
 * deixava acontecer e o banco passa a barrar fica nas constraints: dia pago
 * duas vezes, vigencias de diaria sobrepostas (o `#N/D` ou o valor errado da
 * aba TABELAS), RPA com bruto que nao fecha com liquido + impostos.
 *
 * Dinheiro e centavo inteiro, como no resto do projeto. A excecao e o que um
 * pagamento levou de cada dia (`rpa_payment_days.value_subcents`): diaria / 8
 * a 50% ou 100% por minuto deixa fracao de centavo, e a planilha so
 * arredondava no total. O valor vai em 1/1920 de centavo — o menor
 * denominador comum de diaria/240 (100% por minuto), diaria/320 (50%) e o
 * mesmo para meia diaria —, inteiro e exato, e o arredondamento continua so
 * no total do pagamento.
 *
 * Dado pessoal (CPF, RG, conta, chave Pix) mora em `rpa_workers`. Nada disso
 * vai para log: o `redact` do logger tem os nomes destas colunas.
 */

exports.shorthands = undefined;

const WITH_UPDATED_AT = [
  'rpa_companies',
  'rpa_launches',
  'rpa_rates',
  'rpa_workers',
  'rpa_days',
  'rpa_payments',
  'rpa_files',
];

const timestamps = (pgm) => ({
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

exports.up = (pgm) => {
  // A exclusao de vigencias sobrepostas compara `launch_id` e `role` com `=`
  // dentro de um indice GiST, e isso so existe com o btree_gist.
  pgm.createExtension('btree_gist', { ifNotExists: true });

  pgm.createType('rpa_launch_status', ['open', 'closed']);
  // `payment` e a conta de pagamento (Mercado Pago, PagBank): aparece no
  // formulario de Avare ao lado de corrente e poupanca.
  pgm.createType('rpa_account_type', ['checking', 'savings', 'payment']);
  pgm.createType('rpa_pix_key_type', [
    'cpf',
    'cnpj',
    'email',
    'phone',
    'random',
  ]);
  pgm.createType('rpa_payment_status', ['issued', 'paid', 'canceled']);
  pgm.createType('rpa_payment_part', ['daily', 'extras', 'correction']);
  // O bonus e valor livre, lancado de forma pontual e com motivo: nao cobre
  // dia nenhum (decisao de 2026-10-31). Acrescimo e desconto tambem levam
  // motivo — na planilha eram so um numero na coluna.
  pgm.createType('rpa_adjustment_kind', ['bonus', 'addition', 'deduction']);
  pgm.createType('rpa_tax_kind', ['inss', 'irrf']);
  pgm.createType('rpa_file_kind', [
    'ctps',
    'id_document',
    'address_proof',
    'bank_details',
    'signed_receipt',
  ]);
  pgm.createType('rpa_document_side', ['front', 'back']);

  // Lista publica do Banco Central, semeada na migration seguinte. O banco
  // digitado no formulario e normalizado para um destes codigos (issue 37).
  pgm.createTable('rpa_banks', {
    code: { type: 'varchar(3)', primaryKey: true },
    short_name: { type: 'varchar(100)', notNull: true },
    name: { type: 'varchar(255)', notNull: true },
  });
  pgm.addConstraint('rpa_banks', 'rpa_banks_code_format', {
    check: "code ~ '^[0-9]{3}$'",
  });

  // INSS e IRRF com vigencia pelo inicio: vale a linha de maior `starts_on`
  // ate a data. Sem `ends_on` nao ha como duas vigencias se sobreporem. Uma
  // tabela nova e uma linha nova; o RPA emitido guarda qual usou.
  pgm.createTable('rpa_tax_tables', {
    id: 'id',
    kind: { type: 'rpa_tax_kind', notNull: true },
    starts_on: { type: 'date', notNull: true },
    legal_basis: { type: 'varchar(255)', notNull: true },
    // Aliquota em pontos-base: 11% = 1100. Teto do salario de contribuicao.
    inss_rate_bp: { type: 'integer' },
    inss_ceiling_cents: { type: 'integer' },
    // [{ up_to_cents, rate_bp, deduction_cents }], em ordem; a ultima faixa
    // tem `up_to_cents` nulo.
    irrf_brackets: { type: 'jsonb' },
    irrf_simplified_discount_cents: { type: 'integer' },
    irrf_dependent_deduction_cents: { type: 'integer' },
    // Reducao da Lei 15.270/2025, nula antes de 2026.
    irrf_reduction: { type: 'jsonb' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });
  pgm.addConstraint('rpa_tax_tables', 'rpa_tax_tables_unique_start', {
    unique: ['kind', 'starts_on'],
  });
  pgm.addConstraint('rpa_tax_tables', 'rpa_tax_tables_fields_by_kind', {
    check: `(
      kind = 'inss'
      AND inss_rate_bp IS NOT NULL AND inss_ceiling_cents IS NOT NULL
      AND irrf_brackets IS NULL AND irrf_simplified_discount_cents IS NULL
      AND irrf_dependent_deduction_cents IS NULL AND irrf_reduction IS NULL
    ) OR (
      kind = 'irrf'
      AND inss_rate_bp IS NULL AND inss_ceiling_cents IS NULL
      AND jsonb_typeof(irrf_brackets) = 'array'
      AND irrf_simplified_discount_cents IS NOT NULL
      AND irrf_dependent_deduction_cents IS NOT NULL
      AND (irrf_reduction IS NULL OR jsonb_typeof(irrf_reduction) = 'object')
    )`,
  });
  pgm.addConstraint('rpa_tax_tables', 'rpa_tax_tables_values_not_negative', {
    check: `(inss_rate_bp IS NULL OR inss_rate_bp BETWEEN 0 AND 10000)
      AND (inss_ceiling_cents IS NULL OR inss_ceiling_cents > 0)
      AND (irrf_simplified_discount_cents IS NULL OR irrf_simplified_discount_cents >= 0)
      AND (irrf_dependent_deduction_cents IS NULL OR irrf_dependent_deduction_cents >= 0)`,
  });

  // A aba EMPRESA. O codigo UAU e a identidade de negocio: e o que vai no
  // codigo do RPA e no assunto do e-mail.
  pgm.createTable('rpa_companies', {
    id: 'id',
    code: { type: 'integer', notNull: true, unique: true },
    name: { type: 'varchar(255)', notNull: true },
    cnpj: { type: 'varchar(14)', notNull: true },
    city: { type: 'varchar(255)' },
    state: { type: 'varchar(2)' },
    // Na EMPRESA de Avare os dois vinham vazios para a 815, e o RPA saia com
    // `0` nos campos. Aqui sao o padrao que o lancamento herda.
    service_type: { type: 'varchar(255)' },
    cost_center: { type: 'varchar(50)' },
    ...timestamps(pgm),
  });
  pgm.addConstraint('rpa_companies', 'rpa_companies_code_positive', {
    check: 'code > 0',
  });
  pgm.addConstraint('rpa_companies', 'rpa_companies_name_not_blank', {
    check: "btrim(name) <> ''",
  });
  pgm.addConstraint('rpa_companies', 'rpa_companies_state_format', {
    check: "state IS NULL OR state ~ '^[A-Z]{2}$'",
  });

  pgm.createTable('rpa_launches', {
    id: 'id',
    // RESTRICT: apagar a empresa nao pode levar embora lancamentos com RPA.
    company_id: {
      type: 'integer',
      notNull: true,
      references: 'rpa_companies',
      onDelete: 'RESTRICT',
    },
    city: { type: 'varchar(255)', notNull: true },
    state: { type: 'varchar(2)', notNull: true },
    development: { type: 'varchar(255)', notNull: true },
    starts_on: { type: 'date', notNull: true },
    ends_on: { type: 'date', notNull: true },
    // Feriados valem para a equipe inteira no dia (issue 38).
    holidays: { type: 'date[]', notNull: true, default: '{}' },
    // Nulos ate alguem preencher; a emissao (issue 40) exige os dois, para o
    // RPA nao sair com `0` como saia da planilha.
    service_type: { type: 'varchar(255)' },
    cost_center: { type: 'varchar(50)' },
    // Os campos do e-mail de solicitacao: obra, produto e insumo.
    site: { type: 'varchar(255)' },
    product: { type: 'varchar(255)' },
    supply: { type: 'varchar(255)' },
    email_to: { type: 'text[]', notNull: true, default: '{}' },
    email_cc: { type: 'text[]', notNull: true, default: '{}' },
    // Como se faz hoje: o 1o pagamento so com diarias, os extras dele no
    // seguinte.
    first_payment_daily_only: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    status: { type: 'rpa_launch_status', notNull: true, default: 'open' },
    created_by: {
      type: 'integer',
      references: 'users',
      onDelete: 'SET NULL',
    },
    ...timestamps(pgm),
  });
  pgm.addConstraint('rpa_launches', 'rpa_launches_period_in_order', {
    check: 'ends_on >= starts_on',
  });
  pgm.addConstraint('rpa_launches', 'rpa_launches_state_format', {
    check: "state ~ '^[A-Z]{2}$'",
  });
  pgm.addConstraint('rpa_launches', 'rpa_launches_development_not_blank', {
    check: "btrim(development) <> ''",
  });
  pgm.createIndex('rpa_launches', 'company_id');

  // Horario padrao por dia da semana (ISO: 1 = segunda, 7 = domingo). Dia sem
  // linha e folga. A grade do ponto nasce daqui e so a excecao vira
  // `rpa_days`.
  pgm.createTable('rpa_launch_schedules', {
    launch_id: {
      type: 'integer',
      notNull: true,
      references: 'rpa_launches',
      onDelete: 'CASCADE',
    },
    weekday: { type: 'smallint', notNull: true },
    quantity: { type: 'numeric(2,1)', notNull: true },
    start_time: { type: 'time(0)', notNull: true },
    lunch_out: { type: 'time(0)' },
    lunch_in: { type: 'time(0)' },
    end_time: { type: 'time(0)', notNull: true },
  });
  pgm.addConstraint('rpa_launch_schedules', 'rpa_launch_schedules_pkey', {
    primaryKey: ['launch_id', 'weekday'],
  });
  pgm.addConstraint('rpa_launch_schedules', 'rpa_launch_schedules_weekday', {
    check: 'weekday BETWEEN 1 AND 7',
  });
  pgm.addConstraint('rpa_launch_schedules', 'rpa_launch_schedules_quantity', {
    check: 'quantity IN (0.5, 1)',
  });
  pgm.addConstraint('rpa_launch_schedules', 'rpa_launch_schedules_lunch', {
    check: '(lunch_out IS NULL) = (lunch_in IS NULL)',
  });

  // A diaria do lancamento por funcao (aba TABELAS). Vigencias da mesma
  // funcao nao se sobrepoem: na planilha, duas linhas validas no mesmo dia
  // davam o valor da primeira que o MATCH achasse.
  pgm.createTable('rpa_rates', {
    id: 'id',
    launch_id: {
      type: 'integer',
      notNull: true,
      references: 'rpa_launches',
      onDelete: 'CASCADE',
    },
    role: { type: 'varchar(255)', notNull: true },
    starts_on: { type: 'date', notNull: true },
    ends_on: { type: 'date', notNull: true },
    daily_cents: { type: 'integer', notNull: true },
    // O "promovido" da planilha: a mesma funcao com R$ 10 a mais.
    promoted_bonus_cents: { type: 'integer', notNull: true, default: 0 },
    ...timestamps(pgm),
  });
  pgm.addConstraint('rpa_rates', 'rpa_rates_period_in_order', {
    check: 'ends_on >= starts_on',
  });
  pgm.addConstraint('rpa_rates', 'rpa_rates_daily_positive', {
    check: 'daily_cents > 0',
  });
  pgm.addConstraint('rpa_rates', 'rpa_rates_promoted_bonus_not_negative', {
    check: 'promoted_bonus_cents >= 0',
  });
  pgm.addConstraint('rpa_rates', 'rpa_rates_role_not_blank', {
    check: "btrim(role) <> ''",
  });
  pgm.sql(`
    ALTER TABLE rpa_rates ADD CONSTRAINT rpa_rates_no_overlap
    EXCLUDE USING gist (
      launch_id WITH =,
      role WITH =,
      daterange(starts_on, ends_on, '[]') WITH &&
    )
  `);

  // A pessoa no lancamento, com o que veio do formulario. O CPF e a chave:
  // reimportar casa por ele (issue 37). O formato e conferido aqui; o DV nao,
  // porque CPF com DV errado entra como pendencia, nao como recusa.
  pgm.createTable('rpa_workers', {
    id: 'id',
    launch_id: {
      type: 'integer',
      notNull: true,
      references: 'rpa_launches',
      onDelete: 'CASCADE',
    },
    // Numero fixo da pessoa no lancamento, o que vai no codigo do RPA. Na
    // planilha era a posicao da linha no CADASTRO e mudava ao reordenar.
    number: { type: 'smallint', notNull: true },
    cpf: { type: 'varchar(11)', notNull: true },
    name: { type: 'varchar(255)', notNull: true },
    role: { type: 'varchar(255)' },
    starts_on: { type: 'date' },
    left_on: { type: 'date' },
    // Promocao tem data: a planilha so aplicava o valor de promovido a partir
    // da DATA PROMOCAO do cadastro.
    promoted_since: { type: 'date' },
    // Entra no IRRF. Na planilha era digitado no PAINEL a cada RPA.
    dependents: { type: 'smallint', notNull: true, default: 0 },
    email: { type: 'varchar(255)' },
    rg: { type: 'varchar(20)' },
    rg_issued_on: { type: 'date' },
    birth_date: { type: 'date' },
    birth_place: { type: 'varchar(255)' },
    pis: { type: 'varchar(11)' },
    address: { type: 'varchar(255)' },
    district: { type: 'varchar(255)' },
    city: { type: 'varchar(255)' },
    cep: { type: 'varchar(8)' },
    mother_name: { type: 'varchar(255)' },
    father_name: { type: 'varchar(255)' },
    // Nulo quando o banco digitado nao casou com a lista: vira pendencia, e o
    // nome como veio fica em `bank_name`, que e o que o RPA imprime.
    bank_code: {
      type: 'varchar(3)',
      references: 'rpa_banks',
      onDelete: 'RESTRICT',
    },
    bank_name: { type: 'varchar(255)' },
    agency: { type: 'varchar(10)' },
    bank_operation: { type: 'varchar(10)' },
    account: { type: 'varchar(30)' },
    account_type: { type: 'rpa_account_type' },
    pix_key_type: { type: 'rpa_pix_key_type' },
    pix_key: { type: 'varchar(255)' },
    form_submitted_at: { type: 'timestamptz' },
    // [{ code, field, message, resolved }]: o que nao barra a importacao mas
    // precisa de alguem olhar.
    issues: { type: 'jsonb', notNull: true, default: '[]' },
    ...timestamps(pgm),
  });
  pgm.addConstraint('rpa_workers', 'rpa_workers_unique_cpf_per_launch', {
    unique: ['launch_id', 'cpf'],
  });
  pgm.addConstraint('rpa_workers', 'rpa_workers_unique_number_per_launch', {
    unique: ['launch_id', 'number'],
  });
  pgm.addConstraint('rpa_workers', 'rpa_workers_number_positive', {
    check: 'number >= 1',
  });
  pgm.addConstraint('rpa_workers', 'rpa_workers_cpf_format', {
    check: "cpf ~ '^[0-9]{11}$'",
  });
  pgm.addConstraint('rpa_workers', 'rpa_workers_pis_format', {
    check: "pis IS NULL OR pis ~ '^[0-9]{11}$'",
  });
  pgm.addConstraint('rpa_workers', 'rpa_workers_cep_format', {
    check: "cep IS NULL OR cep ~ '^[0-9]{8}$'",
  });
  pgm.addConstraint('rpa_workers', 'rpa_workers_name_not_blank', {
    check: "btrim(name) <> ''",
  });
  pgm.addConstraint('rpa_workers', 'rpa_workers_left_after_start', {
    check: 'left_on IS NULL OR starts_on IS NULL OR left_on >= starts_on',
  });
  pgm.addConstraint('rpa_workers', 'rpa_workers_dependents_not_negative', {
    check: 'dependents >= 0',
  });
  pgm.addConstraint('rpa_workers', 'rpa_workers_issues_is_array', {
    check: "jsonb_typeof(issues) = 'array'",
  });

  // Pessoa x dia, so a excecao ao horario padrao, e so a entrada: o valor e
  // calculado (issue 38). Quantidade 0 e falta — na planilha, 0 pagava a
  // diaria cheia.
  pgm.createTable('rpa_days', {
    id: 'id',
    worker_id: {
      type: 'integer',
      notNull: true,
      references: 'rpa_workers',
      onDelete: 'CASCADE',
    },
    work_date: { type: 'date', notNull: true },
    quantity: { type: 'numeric(2,1)', notNull: true },
    start_time: { type: 'time(0)' },
    lunch_out: { type: 'time(0)' },
    lunch_in: { type: 'time(0)' },
    end_time: { type: 'time(0)' },
    note: { type: 'varchar(255)' },
    ...timestamps(pgm),
  });
  pgm.addConstraint('rpa_days', 'rpa_days_unique_worker_date', {
    unique: ['worker_id', 'work_date'],
  });
  pgm.addConstraint('rpa_days', 'rpa_days_quantity', {
    check: 'quantity IN (0, 0.5, 1)',
  });
  pgm.addConstraint('rpa_days', 'rpa_days_times_match_quantity', {
    check: `(quantity = 0 AND start_time IS NULL AND end_time IS NULL
               AND lunch_out IS NULL AND lunch_in IS NULL)
            OR (quantity > 0 AND start_time IS NOT NULL AND end_time IS NOT NULL)`,
  });
  pgm.addConstraint('rpa_days', 'rpa_days_lunch', {
    check: '(lunch_out IS NULL) = (lunch_in IS NULL)',
  });

  // O RPA emitido. Imutavel depois de emitido (issue 39): corrigir e
  // cancelar com motivo e emitir de novo.
  pgm.createTable('rpa_payments', {
    id: 'id',
    // RESTRICT: apagar o lancamento nao pode levar embora RPA emitido.
    worker_id: {
      type: 'integer',
      notNull: true,
      references: 'rpa_workers',
      onDelete: 'RESTRICT',
    },
    // O no do pagamento da pessoa (1o, 2o, ...): vai no codigo do RPA.
    number: { type: 'smallint', notNull: true },
    period_start: { type: 'date', notNull: true },
    period_end: { type: 'date', notNull: true },
    payment_date: { type: 'date', notNull: true },
    net_cents: { type: 'integer', notNull: true },
    inss_cents: { type: 'integer', notNull: true },
    irrf_cents: { type: 'integer', notNull: true },
    gross_cents: { type: 'integer', notNull: true },
    irrf_base_cents: { type: 'integer', notNull: true },
    // Congelados na emissao: reimprimir o RPA nao pode mudar o que saiu.
    dependents: { type: 'smallint', notNull: true, default: 0 },
    inss_table_id: {
      type: 'integer',
      notNull: true,
      references: 'rpa_tax_tables',
      onDelete: 'RESTRICT',
    },
    irrf_table_id: {
      type: 'integer',
      notNull: true,
      references: 'rpa_tax_tables',
      onDelete: 'RESTRICT',
    },
    // `no-empresa-pessoa-mmaaaa`.
    code: { type: 'varchar(40)', notNull: true },
    status: { type: 'rpa_payment_status', notNull: true, default: 'issued' },
    issued_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    paid_at: { type: 'timestamptz' },
    canceled_at: { type: 'timestamptz' },
    cancel_reason: { type: 'varchar(255)' },
    created_by: {
      type: 'integer',
      references: 'users',
      onDelete: 'SET NULL',
    },
    ...timestamps(pgm),
  });
  pgm.addConstraint('rpa_payments', 'rpa_payments_period_in_order', {
    check: 'period_end >= period_start',
  });
  pgm.addConstraint('rpa_payments', 'rpa_payments_number_positive', {
    check: 'number >= 1',
  });
  pgm.addConstraint('rpa_payments', 'rpa_payments_values_not_negative', {
    check: `net_cents >= 0 AND inss_cents >= 0 AND irrf_cents >= 0
            AND gross_cents >= 0 AND irrf_base_cents >= 0 AND dependents >= 0`,
  });
  // A conta que o "Atingir Meta" da planilha fazia por aproximacao: aqui ela
  // fecha no centavo ou o RPA nao e gravado.
  pgm.addConstraint('rpa_payments', 'rpa_payments_gross_adds_up', {
    check: 'gross_cents = net_cents + inss_cents + irrf_cents',
  });
  pgm.addConstraint('rpa_payments', 'rpa_payments_code_not_blank', {
    check: "btrim(code) <> ''",
  });
  pgm.addConstraint('rpa_payments', 'rpa_payments_cancel_has_reason', {
    check: `(status = 'canceled') = (canceled_at IS NOT NULL
             AND cancel_reason IS NOT NULL AND btrim(cancel_reason) <> '')`,
  });
  pgm.addConstraint('rpa_payments', 'rpa_payments_paid_has_date', {
    check: "status <> 'paid' OR paid_at IS NOT NULL",
  });
  // Alvo da FK composta de `rpa_payment_days`: garante que o dia levado pelo
  // pagamento e da mesma pessoa do pagamento.
  pgm.addConstraint('rpa_payments', 'rpa_payments_id_worker', {
    unique: ['id', 'worker_id'],
  });
  pgm.createIndex('rpa_payments', 'worker_id');
  // Cancelar libera o numero e o codigo para reemitir.
  pgm.createIndex('rpa_payments', ['worker_id', 'number'], {
    name: 'rpa_payments_unique_number_active',
    unique: true,
    where: "status <> 'canceled'",
  });
  pgm.createIndex('rpa_payments', 'code', {
    name: 'rpa_payments_unique_code_active',
    unique: true,
    where: "status <> 'canceled'",
  });

  // O que cada pagamento levou de cada dia, diaria e extras separados. E o
  // que impede pagar duas vezes: um indice unico entre as linhas que valem.
  // `correction` e a diferenca de um dia ja pago cujo ponto mudou, e pode ser
  // negativa; nao entra no unico, porque um dia pode ser corrigido mais de
  // uma vez.
  pgm.createTable('rpa_payment_days', {
    payment_id: { type: 'integer', notNull: true },
    worker_id: { type: 'integer', notNull: true },
    work_date: { type: 'date', notNull: true },
    part: { type: 'rpa_payment_part', notNull: true },
    // Em 1/1920 de centavo (ver o comentario do topo).
    value_subcents: { type: 'bigint', notNull: true },
    voided: { type: 'boolean', notNull: true, default: false },
  });
  pgm.addConstraint('rpa_payment_days', 'rpa_payment_days_pkey', {
    primaryKey: ['payment_id', 'work_date', 'part'],
  });
  pgm.addConstraint('rpa_payment_days', 'rpa_payment_days_payment_fk', {
    foreignKeys: {
      columns: ['payment_id', 'worker_id'],
      references: 'rpa_payments(id, worker_id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('rpa_payment_days', 'rpa_payment_days_value_sign', {
    check: "part = 'correction' OR value_subcents >= 0",
  });
  pgm.createIndex('rpa_payment_days', ['worker_id', 'work_date', 'part'], {
    name: 'rpa_payment_days_paid_once',
    unique: true,
    where: "NOT voided AND part IN ('daily', 'extras')",
  });

  // Cancelar o RPA libera os dias que ele levou. No banco, e nao no model:
  // cancelar por psql ou script tambem tem de liberar, senao o dia fica
  // preso a um pagamento que nao vale.
  pgm.createFunction(
    'rpa_void_canceled_payment_days',
    [],
    { returns: 'trigger', language: 'plpgsql', replace: true },
    `
    BEGIN
      UPDATE rpa_payment_days SET voided = true WHERE payment_id = NEW.id;
      RETURN NEW;
    END;
    `,
  );
  pgm.createTrigger('rpa_payments', 'rpa_payments_void_days_on_cancel', {
    when: 'AFTER',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'rpa_void_canceled_payment_days',
    condition: "NEW.status = 'canceled' AND OLD.status <> 'canceled'",
  });

  pgm.createTable('rpa_payment_adjustments', {
    id: 'id',
    payment_id: {
      type: 'integer',
      notNull: true,
      references: 'rpa_payments',
      onDelete: 'CASCADE',
    },
    kind: { type: 'rpa_adjustment_kind', notNull: true },
    // Sempre positivo: o sinal sai do tipo. Na planilha o DESC. do 3o
    // pagamento somava em vez de subtrair.
    amount_cents: { type: 'integer', notNull: true },
    reason: { type: 'varchar(255)', notNull: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });
  pgm.addConstraint('rpa_payment_adjustments', 'rpa_adjustments_positive', {
    check: 'amount_cents > 0',
  });
  pgm.addConstraint('rpa_payment_adjustments', 'rpa_adjustments_reason', {
    check: "btrim(reason) <> ''",
  });
  pgm.createIndex('rpa_payment_adjustments', 'payment_id');

  // Documentos do formulario (issue 41) e recibos assinados (issue 42), no
  // mesmo diretorio de upload dos comprovantes e pelo mesmo SHA-256 — por
  // isso a retencao conta as duas tabelas antes de apagar um arquivo.
  pgm.createTable('rpa_files', {
    id: 'id',
    launch_id: {
      type: 'integer',
      notNull: true,
      references: 'rpa_launches',
      onDelete: 'CASCADE',
    },
    // Nulo quando o documento nao casou com ninguem: fica listado para
    // escolher a pessoa na mao.
    worker_id: {
      type: 'integer',
      references: 'rpa_workers',
      onDelete: 'SET NULL',
    },
    payment_id: {
      type: 'integer',
      references: 'rpa_payments',
      onDelete: 'SET NULL',
    },
    kind: { type: 'rpa_file_kind', notNull: true },
    side: { type: 'rpa_document_side' },
    file_hash: { type: 'varchar(128)', notNull: true },
    file_path: { type: 'text', notNull: true },
    content_type: { type: 'varchar(100)', notNull: true },
    byte_size: { type: 'integer', notNull: true },
    ...timestamps(pgm),
  });
  // Frente e verso iguais, ou o mesmo .zip enviado de novo, viram uma linha.
  pgm.addConstraint('rpa_files', 'rpa_files_unique_hash_per_launch', {
    unique: ['launch_id', 'file_hash'],
  });
  pgm.addConstraint('rpa_files', 'rpa_files_byte_size_positive', {
    check: 'byte_size > 0',
  });
  pgm.addConstraint('rpa_files', 'rpa_files_payment_only_on_receipt', {
    check: "payment_id IS NULL OR kind = 'signed_receipt'",
  });
  pgm.addConstraint('rpa_files', 'rpa_files_side_only_on_document', {
    check: "side IS NULL OR kind <> 'signed_receipt'",
  });
  pgm.createIndex('rpa_files', 'file_hash');
  pgm.createIndex('rpa_files', 'worker_id');

  for (const table of WITH_UPDATED_AT) {
    pgm.createTrigger(table, `${table}_set_updated_at`, {
      when: 'BEFORE',
      operation: 'UPDATE',
      level: 'ROW',
      function: 'set_updated_at',
    });
  }
};

exports.down = (pgm) => {
  // dropTable leva junto triggers, indices e constraints. Tipos, funcao e
  // extensao, nao.
  pgm.dropTable('rpa_files');
  pgm.dropTable('rpa_payment_adjustments');
  pgm.dropTable('rpa_payment_days');
  pgm.dropTable('rpa_payments');
  pgm.dropFunction('rpa_void_canceled_payment_days', []);
  pgm.dropTable('rpa_days');
  pgm.dropTable('rpa_workers');
  pgm.dropTable('rpa_rates');
  pgm.dropTable('rpa_launch_schedules');
  pgm.dropTable('rpa_launches');
  pgm.dropTable('rpa_companies');
  pgm.dropTable('rpa_tax_tables');
  pgm.dropTable('rpa_banks');

  pgm.dropType('rpa_document_side');
  pgm.dropType('rpa_file_kind');
  pgm.dropType('rpa_tax_kind');
  pgm.dropType('rpa_adjustment_kind');
  pgm.dropType('rpa_payment_part');
  pgm.dropType('rpa_payment_status');
  pgm.dropType('rpa_pix_key_type');
  pgm.dropType('rpa_account_type');
  pgm.dropType('rpa_launch_status');

  pgm.dropExtension('btree_gist', { ifExists: true });
};
