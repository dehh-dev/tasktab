'use strict';

/**
 * Tres remocoes pedidas depois do primeiro uso real da ferramenta.
 *
 * `issued_time` e `document_ref` foram acrescentados na migration anterior e
 * saem agora: no uso real nenhuma das duas informacoes foi consultada, e coluna
 * que ninguem le e coluna que so atrapalha a revisao. Sao removidas em vez de
 * ficarem ociosas porque o `down` recria as duas — voltar atras custa uma
 * migration, nao um resgate de dado.
 *
 * `hospedagem` sai do enum de categorias. O Postgres nao remove valor de enum,
 * entao o tipo e recriado: renomeia, cria o novo, converte as duas colunas que
 * o usam e derruba o antigo. Nenhuma linha usava o valor quando isto foi
 * escrito, e a conversao falharia alto se alguma passasse a usar.
 */

const CATEGORIES = [
  'alimentacao',
  'combustivel',
  'estacionamento',
  'lavanderia',
  'transporte',
  'outros',
  'nao_classificado',
];

const CATEGORIES_COM_HOSPEDAGEM = [
  'alimentacao',
  'combustivel',
  'estacionamento',
  'lavanderia',
  'transporte',
  'hospedagem',
  'outros',
  'nao_classificado',
];

/**
 * Troca o enum `expense_category` pela lista dada.
 *
 * A ordem dos passos importa: o `DEFAULT` de `merchants.default_category` cita
 * o tipo antigo e impede o `ALTER TYPE`, entao ele cai antes e volta depois.
 */
function trocarEnum(pgm, valores) {
  pgm.sql('ALTER TYPE expense_category RENAME TO expense_category_old');
  pgm.createType('expense_category', valores);

  pgm.sql('ALTER TABLE merchants ALTER COLUMN default_category DROP DEFAULT');

  pgm.sql(`ALTER TABLE receipts
             ALTER COLUMN category TYPE expense_category
             USING category::text::expense_category`);
  pgm.sql(`ALTER TABLE merchants
             ALTER COLUMN default_category TYPE expense_category
             USING default_category::text::expense_category`);

  pgm.sql(`ALTER TABLE merchants
             ALTER COLUMN default_category
             SET DEFAULT 'nao_classificado'::expense_category`);

  pgm.dropType('expense_category_old');
}

exports.up = (pgm) => {
  pgm.dropColumns('receipts', ['issued_time', 'document_ref']);
  trocarEnum(pgm, CATEGORIES);
};

exports.down = (pgm) => {
  trocarEnum(pgm, CATEGORIES_COM_HOSPEDAGEM);

  pgm.addColumns('receipts', {
    issued_time: { type: 'time', notNull: false },
    document_ref: { type: 'varchar(120)', notNull: false },
  });
};
