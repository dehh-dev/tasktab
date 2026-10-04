'use strict';

const {
  parseAmountToCents,
  parseDate,
  extractTotal,
  extractDate,
  extractCnpj,
  extractFuelLines,
  extractDiscounts,
} = require('../../../src/services/extraction/normalize');

describe('parseAmountToCents', () => {
  // Tabela com os formatos reais ja vistos nos emitentes do caso-base.
  const casos = [
    ['R$ 59,60', 5960],
    ['59,60', 5960],
    ['1.234,56', 123456],
    ['1234,56', 123456],
    ['R$ 1.320,28', 132028],
    ['59.60', 5960],
    ['0,01', 1],
    ['0,00', 0],
    ['37,6', 3760],
    ['  R$  48,60  ', 4860],
    ['R$91,19', 9119],
    ['24,36', 2436],
    ['5,98', 598],
    ['12.345,67', 1234567],
    ['1.234.567,89', 123456789],
    ['100', 10000],
    ['100,00', 10000],
    ['VALOR 3,60', 360],
    [1234, 123400],
  ];

  it.each(casos)('converte %p em %p centavos', (entrada, esperado) => {
    expect(parseAmountToCents(entrada)).toBe(esperado);
  });

  it('trata o ponto com tres digitos como milhar', () => {
    // O unico caso genuinamente ambiguo. A regra escolhe milhar porque e o
    // que a impressao brasileira usa; cupom com centavos sempre traz duas
    // casas.
    expect(parseAmountToCents('1.234')).toBe(123400);
  });

  it('trata o ponto com duas casas como decimal', () => {
    expect(parseAmountToCents('1.23')).toBe(123);
  });

  const invalidos = ['', '   ', 'R$', 'abc', null, undefined, {}, 'sem numero'];

  it.each(invalidos)('devolve null para %p', (entrada) => {
    // Nunca NaN e nunca 0: zero e plausivel e passaria despercebido.
    expect(parseAmountToCents(entrada)).toBeNull();
  });
});

describe('parseDate', () => {
  const casos = [
    ['19/06/2026', '2026-06-19'],
    ['1/6/2026', '2026-06-01'],
    ['2026-06-19', '2026-06-19'],
    ['19/06/26', '2026-06-19'],
    ['19-06-2026', '2026-06-19'],
    ['Emissao: 23/06/2026 18:40', '2026-06-23'],
  ];

  it.each(casos)('converte %p em %p', (entrada, esperado) => {
    expect(parseDate(entrada)).toBe(esperado);
  });

  it('rejeita data que nao existe no calendario', () => {
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('2026-02-31')).toBeNull();
  });

  it('rejeita mes fora da faixa', () => {
    expect(parseDate('19/13/2026')).toBeNull();
  });

  it('devolve null para entrada sem data', () => {
    expect(parseDate('sem data aqui')).toBeNull();
    expect(parseDate(null)).toBeNull();
  });

  it('nao desloca a data pela timezone', () => {
    // O primeiro dia do mes e o caso que denuncia: com `new Date(string)` em
    // timezone negativa ele volta para o ultimo dia do mes anterior.
    expect(parseDate('01/06/2026')).toBe('2026-06-01');
    expect(parseDate('2026-01-01')).toBe('2026-01-01');
  });
});

describe('extractTotal', () => {
  it('acha o total ancorado na palavra-chave', () => {
    const texto = [
      'CNPJ 26.048.802/0001-65',
      'ITEM 001 REFEICAO 1 UN 37,60',
      'VALOR TOTAL R$ 37,60',
    ].join('\n');

    expect(extractTotal(texto)).toBe(3760);
  });

  it('nunca pega o maior numero da pagina', () => {
    // A chave de acesso tem 44 digitos e o CNPJ tem 14: os dois sao maiores
    // que qualquer refeicao. Foi para evitar exatamente isso que a busca e
    // ancorada.
    const texto = [
      'Chave de acesso 52260626048802000165650010001631601303284889',
      'CNPJ 26.048.802/0001-65',
      'Telefone 62999887766',
      'VALOR TOTAL R$ 37,60',
    ].join('\n');

    expect(extractTotal(texto)).toBe(3760);
  });

  it('reconhece as variacoes de ancora dos emitentes', () => {
    expect(extractTotal('Total a pagar 91,19')).toBe(9119);
    expect(extractTotal('Valor a Pagar R$ 24,36')).toBe(2436);
    expect(extractTotal('TOTAL R$ 5,98')).toBe(598);
    expect(extractTotal('Valor cobrado R$ 48,60')).toBe(4860);
  });

  it('prefere a ancora mais especifica quando ha mais de uma', () => {
    const texto = ['Total itens 30,00', 'VALOR TOTAL R$ 37,60'].join('\n');

    expect(extractTotal(texto)).toBe(3760);
  });

  it('devolve null quando nao ha ancora', () => {
    expect(extractTotal('cupom sem total impresso 37,60')).toBeNull();
    expect(extractTotal('')).toBeNull();
    expect(extractTotal(null)).toBeNull();
  });
});

describe('extractDate', () => {
  it('acha a data de emissao no meio do cupom', () => {
    const texto = ['CUPOM FISCAL', 'Emissao: 19/06/2026 12:34:56'].join('\n');

    expect(extractDate(texto)).toBe('2026-06-19');
  });
});

describe('extractCnpj', () => {
  it('extrai com e sem mascara, sempre com 14 digitos', () => {
    expect(extractCnpj('CNPJ 26.048.802/0001-65')).toBe('26048802000165');
    expect(extractCnpj('CNPJ 26048802000165')).toBe('26048802000165');
  });

  it('devolve null quando nao ha CNPJ', () => {
    expect(extractCnpj('sem documento')).toBeNull();
  });

  it('extrai o CNPJ alfanumerico, em maiuscula e sem mascara', () => {
    expect(extractCnpj('CNPJ 12.ABC.345/01DE-35')).toBe('12ABC34501DE35');
  });

  it('nao toma palavra com formato de CNPJ alfanumerico por um', () => {
    expect(extractCnpj('SUPERMERCADO12 CNPJ 26.048.802/0001-65')).toBe(
      '26048802000165',
    );
  });

  it('nao recorta 14 digitos de dentro da chave de acesso', () => {
    expect(
      extractCnpj('52260626048802000165650010001631601303284889'),
    ).toBeNull();
  });
});

describe('extractFuelLines', () => {
  // Os dois exemplos do procedimento, a linha do OCR de Itapipoca e a da nota
  // de Formosa com o preco sujo — esta e lida, mas nao fecha a propria conta.
  const casos = [
    ['39,56 L 5,70 225,49', { totalCents: 22549, closes: true }],
    ['18,461 L X 4,97 91,75', { totalCents: 9175, closes: true }],
    ['39,560 LT X 5,700 = 225,49', { totalCents: 22549, closes: true }],
    ['18.461 L x R$49,97 R$ 91.75', { totalCents: 9175, closes: false }],
  ];

  it.each(casos)('%s', (linha, esperado) => {
    expect(extractFuelLines(linha)).toEqual([
      expect.objectContaining(esperado),
    ]);
  });

  it('separador unico e decimal: 18.461 sao litros, nao milhares', () => {
    expect(extractFuelLines('18.461 L x 4,97 91,75')[0]).toMatchObject({
      liters: 18461,
      unitPrice: 4970,
    });
  });

  it('ignora o que nao e linha de abastecimento', () => {
    const texto = [
      '000004 — ETANOL Bi06 Bo03 TqO2 EI95341,32',
      '.. VALOR TOTAL Ri 2... 2.225,49',
      'AGUA MINERAL 1,5 L',
    ].join('\n');

    expect(extractFuelLines(texto)).toEqual([]);
  });

  it('a ancora nao atravessa a quebra de linha', () => {
    // Litros numa linha e preco e total na seguinte nao sao uma linha so.
    expect(extractFuelLines('39,56 L\n5,70 225,49')).toEqual([]);
  });
});

describe('extractDiscounts', () => {
  const casos = [
    ['DESCONTO 5,00', [500]],
    ['Desconto R$ -5,00', [500]],
    ['(-) Desc. 0,50', [50]],
    ['VALOR DESCONTO: R$ 12,30', [1230]],
    ['Descontos R$ 1.000,00', [100000]],
  ];

  it.each(casos)('%s', (linha, esperado) => {
    expect(extractDiscounts(linha)).toEqual(esperado);
  });

  it('ignora o que nao e linha de desconto', () => {
    const texto = [
      'DESCRICAO QTD UN VL TOTAL 225,49',
      'Ganhe desconto de 10% no proximo abastecimento',
      'Desconto no proximo abastecimento',
      'VALOR A PAGAR R$ 220,49',
    ].join('\n');

    expect(extractDiscounts(texto)).toEqual([]);
  });

  it('devolve um valor por linha de desconto', () => {
    expect(extractDiscounts('DESC ITEM 5,00\nDescontos R$ 5,00')).toEqual([
      500, 500,
    ]);
  });
});
