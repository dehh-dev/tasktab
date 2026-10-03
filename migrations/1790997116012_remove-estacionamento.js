'use strict';

/**
 * As cinco categorias do procedimento de prestacao de contas: Alimentacao,
 * Taxi/Locomocao, Combustivel, Lavanderia e Outros (issue 40).
 *
 * `estacionamento` sai do enum. No Anexo I ele ja caia em X, a coluna de
 * Outras, e o procedimento manda para Outros o que nao se encaixa.
 *
 * O Postgres nao remove valor de enum, entao o tipo e recriado, como na
 * remocao de `hospedagem`. A diferenca e que aqui pode haver linha usando o
 * valor: o `up` a converte para `outros` antes de trocar o tipo, nas duas
 * colunas que o usam. O `down` devolve o valor ao enum, mas **nao** as linhas
 * — nao ha como saber quais `outros` eram estacionamento. Voltar atras custa a
 * classificacao dessas linhas, nao o dado.
 */

const CATEGORIES = [
  'alimentacao',
  'combustivel',
  'lavanderia',
  'transporte',
  'outros',
  'nao_classificado',
];

const CATEGORIES_COM_ESTACIONAMENTO = [
  'alimentacao',
  'combustivel',
  'estacionamento',
  'lavanderia',
  'transporte',
  'outros',
  'nao_classificado',
];

/**
 * Troca o enum `expense_category` pela lista dada.
 *
 * A mesma sequencia da migration de `hospedagem`, copiada e nao importada: uma
 * migration ja aplicada nao pode mudar de comportamento porque alguem mexeu
 * num helper compartilhado. O `DEFAULT` de `merchants.default_category` cita o
 * tipo antigo e impede o `ALTER TYPE`, entao ele cai antes e volta depois.
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
  pgm.sql(
    "UPDATE receipts SET category = 'outros' WHERE category = 'estacionamento'",
  );
  pgm.sql(
    "UPDATE merchants SET default_category = 'outros' WHERE default_category = 'estacionamento'",
  );

  trocarEnum(pgm, CATEGORIES);
};

exports.down = (pgm) => {
  trocarEnum(pgm, CATEGORIES_COM_ESTACIONAMENTO);
};
