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

/**
 * O RPCI que o RH gera no Senior (FPTE004.COL), um PDF por pessoa e com
 * camada de texto, conferido contra um recibo real de Avare (out/2026). Os
 * dados aqui sao sinteticos; a forma e a do real.
 *
 * Na camada de texto as linhas vem fora da ordem da pagina: o nome fica
 * **antes** do rotulo "NOME COMPLETO", e o valor do "LIQUIDO:" vem depois do
 * total de descontos. O OCR do recibo assinado e escaneado le na ordem da
 * pagina, com o nome **depois** do rotulo.
 */
const SENIOR_TEXT_LAYER = [
  'N* RECIBO',
  '000000007',
  'MATRÍCULA (CEI ou CNPJ)',
  'INSS/PIS:',
  'CPF:',
  'NÚMERO DE INSCRIÇÃO',
  'Valor Serviço Prestado:',
  'DATALOCALIDADE',
  '22/10/2026',
  '00000000000',
  '529.982.247-25',
  'NOME OU RAZÃO SOCIAL DA EMPRESA',
  'Recibo de Pagamento a Contribuinte Individual - RPCI',
  'RUA SINTETICA , 100',
  'BAIRRO SINTETICO',
  'EMPRESA SINTETICA SPE LTDA',
  'Avare - SP',
  'MARIA DA CONCEICAO SILVA',
  'NOME COMPLETO',
  'ASSINATURA',
  '1. Contr. INSS:',
  '730,33',
  '80,33',
  'LÍQUIDO:',
  '80,33',
  '650,00',
  'Total Desctos:',
  '26.048.802/0001-65',
  'Recebi da empresa acima identificada, pela prestação dos serviços de SERVIÇOS ADMINISTRATIVOS DE VENDAS, a importância de R$',
  '650,00 -- ( seiscentos e cinquenta reais ), conforme discriminativo abaixo :',
  'Data Pagto Empresa Base INSS Base Acumulada Desconto INSSCompetência',
  '22/10/2026 730,33 730,33 80,33EMPRESA SINTETICA SPE LTDA10/2026',
  'TETO INSS: 8.475,55',
].join('\n');

const SENIOR_PAGE_ORDER = [
  'Recibo de Pagamento a Contribuinte Individual - RPCI   N* RECIBO',
  'NOME OU RAZAO SOCIAL DA EMPRESA   MATRICULA (CEI ou CNPJ)',
  'EMPRESA SINTETICA SPE LTDA   26.048.802/0001-65',
  'Recebi da empresa acima identificada, pela prestacao dos servicos de SERVICOS ADMINISTRATIVOS DE VENDAS, a importancia de R$',
  '650,00 -- ( seiscentos e cinquenta reais ), conforme discriminativo abaixo :',
  'INSS/PIS: 00000000000   Valor Servico Prestado: 730,33',
  'CPF: 529.982.247-25',
  '1. Contr. INSS: 80,33',
  'Total Desctos: 80,33',
  'LOCALIDADE   DATA   LIQUIDO: 650,00',
  'ASSINATURA',
  'Avare - SP   22/10/2026',
  'NOME COMPLETO',
  'MARIA DA CONCEICAO SILVA',
].join('\n');

describe('o RPCI do RH (Senior)', () => {
  it.each([
    ['camada de texto', SENIOR_TEXT_LAYER],
    ['ordem da pagina (OCR)', SENIOR_PAGE_ORDER],
  ])('na %s, le nome, CPF, liquido e data', (_, page) => {
    expect(readName(page)).toBe('MARIA DA CONCEICAO SILVA');
    expect(readCpfs(page)).toEqual(['52998224725']);
    expect(readNetCents(page)).toBe(65000);
    expect(readDate(page)).toBe('2026-10-22');
  });

  it('"nome ou razao social" e a empresa, nunca a pessoa', () => {
    expect(
      readName('NOME OU RAZÃO SOCIAL DA EMPRESA\nEMPRESA SINTETICA SPE LTDA'),
    ).toBeNull();
  });

  it('o rotulo sozinho sem um nome ao lado nao inventa um', () => {
    expect(readName('NOME COMPLETO\nASSINATURA\n22/10/2026')).toBeNull();
  });

  it('sem valor na linha do liquido, vale "a importancia de R$" do corpo', () => {
    expect(
      readNetCents('LIQUIDO:\n17,30\na importancia de R$ 1.140,00 -- ( mil )'),
    ).toBe(114000);
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
