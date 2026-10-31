'use strict';

/**
 * INSS e IRRF do RPA e o bruto a partir do liquido (issue 39), em centavos
 * inteiros. Substitui o "Atingir Meta" da planilha, que achava o bruto por
 * aproximacao e o gravava com casas que o centavo nao tem.
 *
 * As tabelas sao as linhas de `rpa_tax_tables` vigentes na data do
 * pagamento. O mes acumula por CPF e fonte pagadora: `previous` e a soma dos
 * RPAs ja emitidos no mes para a mesma pessoa e o mesmo CNPJ.
 */

// Pendente de confirmacao com o financeiro (issue 35). O recibo RPCI de Avare
// devolveu R$ 650,01 para um RPA de R$ 650,00 da planilha: so fecha com o
// INSS truncado no centavo. O IRRF fica no arredondamento comum ate alguem
// confirmar — para os valores destes RPAs ele e zero em 2026.
const ROUNDING = { inss: 'truncate', irrf: 'round' };

const BASIS_POINTS = 10000;
const MILLIONTHS = 1000000;

// O liquido pode recuar um centavo quando INSS e IRRF sobem no mesmo centavo
// de bruto. A queda nunca passa de 5 centavos de bruto (as duas aliquotas
// somam menos de 52%), entao o menor bruto fica nesta janela abaixo do achado.
const GROSS_WINDOW = 10;

const NO_PREVIOUS = Object.freeze({
  gross_cents: 0,
  inss_cents: 0,
  irrf_cents: 0,
  irrf_base_cents: 0,
});

/** `numerator / denominator` em centavos, para numerador >= 0. */
function toCents(numerator, denominator, mode) {
  if (mode === 'truncate') return Math.floor(numerator / denominator);
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/**
 * INSS do RPA: a aliquota sobre o bruto, limitado ao que falta para o teto do
 * salario de contribuicao no mes.
 */
function inssFor(grossCents, previousGrossCents, table) {
  const room = Math.max(0, table.inss_ceiling_cents - previousGrossCents);
  const base = Math.min(grossCents, room);

  return toCents(base * table.inss_rate_bp, BASIS_POINTS, ROUNDING.inss);
}

function bracketTax(baseCents, brackets) {
  const bracket = brackets.find(
    (entry) => entry.up_to_cents === null || baseCents <= entry.up_to_cents,
  );
  const tax =
    baseCents * bracket.rate_bp - bracket.deduction_cents * BASIS_POINTS;

  return tax <= 0 ? 0 : toCents(tax, BASIS_POINTS, ROUNDING.irrf);
}

/**
 * A reducao da Lei 15.270/2025, sobre o rendimento tributavel do mes: ate o
 * primeiro limite o imposto zera; ate o segundo, cai `constante - coeficiente x
 * rendimento`, sem passar do proprio imposto.
 */
function reductionFor(incomeCents, reduction, tax) {
  if (!reduction || tax === 0) return 0;
  if (incomeCents <= reduction.full_up_to_cents) return tax;
  if (incomeCents > reduction.partial_up_to_cents) return 0;

  const value =
    reduction.constant_cents * MILLIONTHS -
    reduction.coefficient_millionths * incomeCents;

  return value <= 0
    ? 0
    : Math.min(tax, toCents(value, MILLIONTHS, ROUNDING.irrf));
}

/**
 * IRRF do mes inteiro. Base = o menor entre rendimento - desconto
 * simplificado e rendimento - INSS - dependentes x deducao.
 */
function irrfFor({ incomeCents, inssCents, dependents, table }) {
  const legal =
    incomeCents - inssCents - dependents * table.irrf_dependent_deduction_cents;
  const simplified = incomeCents - table.irrf_simplified_discount_cents;
  const base = Math.max(0, Math.min(legal, simplified));
  const tax = bracketTax(base, table.irrf_brackets);

  return {
    base_cents: base,
    irrf_cents: tax - reductionFor(incomeCents, table.irrf_reduction, tax),
  };
}

/**
 * Os impostos de um RPA de bruto `grossCents`, descontado o que o mes ja
 * reteve. A base do IRRF gravada e a parte deste RPA na base do mes, para a
 * soma das bases impressas dar a base do mes.
 */
function taxesFor({
  grossCents,
  previous = NO_PREVIOUS,
  dependents = 0,
  inssTable,
  irrfTable,
}) {
  const inss = inssFor(grossCents, previous.gross_cents, inssTable);
  const month = irrfFor({
    incomeCents: previous.gross_cents + grossCents,
    inssCents: previous.inss_cents + inss,
    dependents,
    table: irrfTable,
  });
  const irrf = Math.max(0, month.irrf_cents - previous.irrf_cents);

  return {
    gross_cents: grossCents,
    inss_cents: inss,
    irrf_cents: irrf,
    irrf_base_cents: Math.max(0, month.base_cents - previous.irrf_base_cents),
    net_cents: grossCents - inss - irrf,
  };
}

/**
 * O menor bruto, em centavos, cujo liquido pela conta acima e exatamente
 * `netCents`. INSS e IRRF so crescem com o bruto, e cada centavo de bruto muda
 * o liquido em -1, 0 ou +1: a busca binaria acha um ponto em que o liquido
 * chega ao alvo, e a janela abaixo dele acha o menor.
 */
function grossForNet(netCents, context) {
  const netOf = (gross) =>
    taxesFor({ ...context, grossCents: gross }).net_cents;

  if (netCents <= 0) return taxesFor({ ...context, grossCents: 0 });

  // O liquido nunca passa do bruto: com bruto = alvo - 1 ainda falta.
  let low = netCents - 1;
  let high = netCents;

  while (netOf(high) < netCents) {
    low = high;
    high *= 2;
  }

  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (netOf(middle) >= netCents) high = middle;
    else low = middle;
  }

  let best = high;
  for (let gross = high - 1; gross >= high - GROSS_WINDOW; gross -= 1) {
    if (gross >= 0 && netOf(gross) === netCents) best = gross;
  }

  return taxesFor({ ...context, grossCents: best });
}

module.exports = {
  ROUNDING,
  NO_PREVIOUS,
  inssFor,
  irrfFor,
  taxesFor,
  grossForNet,
};
