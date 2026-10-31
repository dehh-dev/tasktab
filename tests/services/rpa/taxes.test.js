'use strict';

const {
  inssFor,
  irrfFor,
  taxesFor,
  grossForNet,
} = require('../../../src/services/rpa/taxes');

// As tabelas da semente (`migrations/..._seed-rpa-banks-and-taxes.js`),
// como o banco as devolve.
const INSS_2026 = { inss_rate_bp: 1100, inss_ceiling_cents: 847555 };

const IRRF_2024 = {
  irrf_brackets: [
    { up_to_cents: 225920, rate_bp: 0, deduction_cents: 0 },
    { up_to_cents: 282665, rate_bp: 750, deduction_cents: 16944 },
    { up_to_cents: 375105, rate_bp: 1500, deduction_cents: 38144 },
    { up_to_cents: 466468, rate_bp: 2250, deduction_cents: 66277 },
    { up_to_cents: null, rate_bp: 2750, deduction_cents: 89600 },
  ],
  irrf_simplified_discount_cents: 56480,
  irrf_dependent_deduction_cents: 18959,
  irrf_reduction: null,
};

const IRRF_2026 = {
  irrf_brackets: [
    { up_to_cents: 242880, rate_bp: 0, deduction_cents: 0 },
    { up_to_cents: 282665, rate_bp: 750, deduction_cents: 18216 },
    { up_to_cents: 375105, rate_bp: 1500, deduction_cents: 39416 },
    { up_to_cents: 466468, rate_bp: 2250, deduction_cents: 67549 },
    { up_to_cents: null, rate_bp: 2750, deduction_cents: 90873 },
  ],
  irrf_simplified_discount_cents: 60720,
  irrf_dependent_deduction_cents: 18959,
  irrf_reduction: {
    full_up_to_cents: 500000,
    partial_up_to_cents: 735000,
    constant_cents: 97862,
    coefficient_millionths: 133145,
  },
};

const TABLES_2026 = { inssTable: INSS_2026, irrfTable: IRRF_2026 };

describe('grossForNet: os criterios da issue 39, com o INSS truncado', () => {
  it.each([
    // Arredondado daria 730,34 e INSS 80,34, como a planilha: o financeiro
    // devolveu R$ 650,01.
    [65000, 73033, 8033],
    [66000, 74157, 8157],
    [78000, 87640, 9640],
  ])('liquido %i -> bruto %i e INSS %i', (net, gross, inss) => {
    expect(grossForNet(net, TABLES_2026)).toEqual({
      gross_cents: gross,
      inss_cents: inss,
      irrf_cents: 0,
      irrf_base_cents: gross - 60720,
      net_cents: net,
    });
  });

  it('acha sempre o menor bruto que fecha o liquido no centavo', () => {
    const contexts = [
      TABLES_2026,
      { ...TABLES_2026, dependents: 2 },
      // Um RPA ja emitido no mes, perto do teto e da faixa de 27,5%.
      {
        ...TABLES_2026,
        previous: {
          gross_cents: 700000,
          inss_cents: 77000,
          irrf_cents: 0,
          irrf_base_cents: 639280,
        },
      },
      { inssTable: INSS_2026, irrfTable: IRRF_2024 },
    ];

    for (const context of contexts) {
      for (let net = 100; net <= 1500000; net += 997) {
        const result = grossForNet(net, context);
        expect(result.net_cents).toBe(net);

        for (let below = 1; below <= 12; below += 1) {
          const lower = taxesFor({
            ...context,
            grossCents: result.gross_cents - below,
          });
          expect(lower.net_cents).not.toBe(net);
        }
      }
    }
  });

  it('liquido zero da bruto zero', () => {
    expect(grossForNet(0, TABLES_2026).gross_cents).toBe(0);
  });
});

describe('irrfFor', () => {
  // Bruto de R$ 4.800,00 no mes, sem dependentes: INSS de R$ 528,00.
  const JUNE = { incomeCents: 480000, inssCents: 52800, dependents: 0 };

  it('em 2026, R$ 4.800,00 no mes sai sem IRRF pela reducao da Lei 15.270', () => {
    expect(irrfFor({ ...JUNE, table: IRRF_2026 }).irrf_cents).toBe(0);
  });

  it('a tabela da planilha (fev/2024), sem a reducao, reteria R$ 290,15', () => {
    expect(irrfFor({ ...JUNE, table: IRRF_2024 })).toEqual({
      base_cents: 480000 - 56480,
      irrf_cents: 29015,
    });
  });

  it('a base e o menor entre o desconto simplificado e o legal', () => {
    // Com 3 dependentes o legal (4.800 - 528 - 568,77) fica abaixo do
    // simplificado (4.800 - 607,20).
    expect(
      irrfFor({ ...JUNE, dependents: 3, table: IRRF_2026 }).base_cents,
    ).toBe(480000 - 52800 - 3 * 18959);
  });

  it.each([
    // Na faixa da reducao parcial: imposto - (978,62 - 0,133145 x rendimento).
    [600000, 66000, 38002],
    // Acima de R$ 7.350,00, sem reducao.
    [800000, 88000, 104927],
  ])('rendimento %i com INSS %i -> IRRF %i', (income, inss, irrf) => {
    expect(
      irrfFor({
        incomeCents: income,
        inssCents: inss,
        dependents: 0,
        table: IRRF_2026,
      }).irrf_cents,
    ).toBe(irrf);
  });

  it('a reducao nao tem degrau: um centavo acima de R$ 5.000,00 quase nada muda', () => {
    const at = (income) =>
      irrfFor({
        incomeCents: income,
        inssCents: Math.floor(income * 0.11),
        dependents: 0,
        table: IRRF_2026,
      }).irrf_cents;

    expect(at(500000)).toBe(0);
    expect(at(500001)).toBeLessThanOrEqual(1);
  });
});

describe('taxesFor: o acumulado do mes', () => {
  it('o segundo RPA do mes respeita o teto do INSS somado', () => {
    const first = taxesFor({ ...TABLES_2026, grossCents: 800000 });
    const second = taxesFor({
      ...TABLES_2026,
      grossCents: 100000,
      previous: first,
    });

    expect(first.inss_cents).toBe(88000);
    // So R$ 475,55 cabiam ate o teto de R$ 8.475,55.
    expect(second.inss_cents).toBe(Math.floor(47555 * 0.11));
    expect(first.inss_cents + second.inss_cents).toBeLessThanOrEqual(
      Math.floor(847555 * 0.11),
    );
  });

  it('com o teto ja batido, o INSS do mes seguinte RPA e zero', () => {
    expect(
      taxesFor({
        ...TABLES_2026,
        grossCents: 50000,
        previous: {
          gross_cents: 900000,
          inss_cents: 93230,
          irrf_cents: 0,
          irrf_base_cents: 0,
        },
      }).inss_cents,
    ).toBe(0);
  });

  it('o IRRF do mes desconta o que o RPA anterior ja reteve', () => {
    const alone = taxesFor({ ...TABLES_2026, grossCents: 900000 });
    const first = taxesFor({ ...TABLES_2026, grossCents: 450000 });
    const second = taxesFor({
      ...TABLES_2026,
      grossCents: 450000,
      previous: first,
    });

    // Isolado, cada um ficava isento; somados, o mes paga o que pagaria um
    // RPA so — a PAGTOS sem mes e ano calculava cada um sozinho.
    expect(first.irrf_cents).toBe(0);
    expect(second.irrf_cents).toBe(alone.irrf_cents);
    expect(first.irrf_base_cents + second.irrf_base_cents).toBe(
      alone.irrf_base_cents,
    );
  });

  it('INSS por fora do teto: a aliquota sobre o bruto, truncada', () => {
    expect(inssFor(73033, 0, INSS_2026)).toBe(8033);
  });
});
