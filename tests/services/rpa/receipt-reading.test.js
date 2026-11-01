'use strict';

const {
  readCpfs,
  readName,
  readNetCents,
  readDate,
  matchPage,
  sameName,
} = require('../../../src/services/rpa/receipt-reading');

// Um recibo como o OCR o devolve: linhas, espacos a mais, acento sumido.
const PAGE = [
  'RECIBO DE PAGAMENTO A CONTRIBUINTE INDIVIDUAL',
  'Nome:  MARIA DA CONCEICAO SILV',
  'CPF: 529.982.247-25',
  'Valor bruto: R$ 730,33',
  'INSS: R$ 80,33',
  'Valor liquido:   R$ 650,01',
  'Data: 20/10/2026',
].join('\n');

const CANDIDATES = [
  {
    worker: { id: 1, cpf: '52998224725', name: 'Maria da Conceição Silva' },
  },
  { worker: { id: 2, cpf: '11144477735', name: 'João Araújo' } },
];

describe('leitura do recibo', () => {
  it('le nome, CPF, liquido e data pela palavra da linha', () => {
    expect(readName(PAGE)).toBe('MARIA DA CONCEICAO SILV');
    expect(readCpfs(PAGE)).toEqual(['52998224725']);
    expect(readNetCents(PAGE)).toBe(65001);
    expect(readDate(PAGE)).toBe('2026-10-20');
  });

  it('CPF com o espaco do OCR no lugar do ponto ainda e lido', () => {
    expect(readCpfs('CPF 529 982 247-25')).toEqual(['52998224725']);
  });

  it('CPF com um digito trocado pelo OCR nao fecha o DV e e descartado', () => {
    expect(readCpfs('CPF: 529.982.247-26')).toEqual([]);
  });

  it('o que nao esta na pagina e null', () => {
    expect(readName('sem rotulo')).toBeNull();
    expect(readNetCents('Valor bruto: R$ 730,33')).toBeNull();
    expect(readDate('sem data')).toBeNull();
  });

  it('o liquido e o ultimo valor da linha, com milhar', () => {
    expect(readNetCents('Liquido a receber (R$) 1.234,56')).toBe(123456);
  });

  it('sem linha "data", vale a primeira data da pagina', () => {
    expect(readDate('Avare, 21/10/2026\nAssinatura')).toBe('2026-10-21');
  });
});

describe('matchPage', () => {
  it('casa pelo CPF, mesmo com o nome errado no recibo', () => {
    expect(matchPage(PAGE, CANDIDATES)).toMatchObject({
      candidate: { worker: { id: 1 } },
      by: 'cpf',
    });
  });

  it('o CPF vale mais que o nome: nome de outra pessoa no recibo nao muda o dono', () => {
    const page = 'Nome: Joao Araujo\nCPF: 529.982.247-25';

    expect(matchPage(page, CANDIDATES)).toMatchObject({
      candidate: { worker: { id: 1 } },
      by: 'cpf',
    });
  });

  it('sem CPF legivel, casa pelo primeiro e ultimo nome do cadastro', () => {
    const page = 'Nome: Joao Araujo\nCPF: 111.444.777-3?';

    expect(matchPage(page, CANDIDATES)).toMatchObject({
      candidate: { worker: { id: 2 } },
      by: 'name',
    });
  });

  it('CPF de quem nao esta no pagamento e nome nenhum: pagina sem pessoa', () => {
    const page = 'Nome: Pessoa de Fora\nCPF: 111.444.777-35';

    expect(matchPage(page, [CANDIDATES[0]])).toEqual({
      candidate: null,
      by: null,
      cpfs: ['11144477735'],
    });
  });

  it('nome que serve a duas pessoas nao decide', () => {
    const twins = [
      { worker: { id: 1, cpf: '52998224725', name: 'Ana Souza' } },
      { worker: { id: 2, cpf: '11144477735', name: 'Ana Maria Souza' } },
    ];

    expect(matchPage('Nome: Ana Souza', twins).candidate).toBeNull();
  });
});

describe('sameName', () => {
  it('ignora acento, caixa e espaco a mais', () => {
    expect(
      sameName('MARIA DA CONCEICAO  SILVA', 'Maria da Conceição Silva'),
    ).toBe(true);
    expect(
      sameName('MARIA DA CONCEICAO SILV', 'Maria da Conceição Silva'),
    ).toBe(false);
  });
});
