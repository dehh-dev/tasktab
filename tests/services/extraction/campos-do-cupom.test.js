'use strict';

const {
  extractDate,
  extractCity,
  extractTotal,
  extractLooseTotal,
} = require('../../../src/services/extraction/normalize');
const {
  guessCategory,
} = require('../../../src/services/extraction/category-guess');
const { merchantName } = require('../../../src/services/extraction/parsers');

// Recorte do texto que o OCR devolveu para um cupom real deste projeto. Os
// erros de leitura sao os de verdade ("NiC-e", "Séria", "MLIMENTOS"): um
// fixture limpo nao exercita nada do que quebrou em producao.
const CUPOM_ESCANEADO = [
  'OE',
  '(Nie anfre o DIVINA GRILL',
  'PIO 35.295.467/0001-90 CEA COMERCIO DE MLIMENTOS',
  'AU DOLITO& SILAS NMUNGUBA, 2800 SERRINHA FORTALEZA-CE 60714-242',
  'th Código Descrivão Otde Un Valor unit. Valor total',
  '001 1260 SEFRI COCA COLA KS 290 ZERO 1 UN X 9,00 9,00',
  'Valor total R$ 165.00',
  'NiC-e nº 000003210 Séria 012 02/06/2026 13:54:24',
  'Data de Autorização 02/08/2026 13:59:27',
].join('\n');

describe('extractDate ancorada', () => {
  it('prefere a data da autorizacao a primeira data da pagina', () => {
    // O caso que motivou a ancora: o OCR leu 6 no lugar do 8 na linha do
    // documento, e agosto virou junho numa prestacao ja assinada.
    expect(extractDate(CUPOM_ESCANEADO)).toBe('2026-08-02');
  });

  it('cai para a primeira data plausivel quando nao ha ancora', () => {
    // Sem ancora, preenchido ainda e melhor que vazio: a revisao confere.
    expect(extractDate('cupom simples 19/06/2026')).toBe('2026-06-19');
  });

  it('devolve null quando nao ha data nenhuma', () => {
    expect(extractDate('recibo manuscrito sem data legivel')).toBeNull();
  });
});

describe('extractTotal', () => {
  it('nao atravessa a quebra de linha atras do numero', () => {
    // O cabecalho da tabela termina em "Valor total" e a linha seguinte comeca
    // com o codigo do item: sem o corte por linha, o total virava R$ 1,00.
    expect(extractTotal(CUPOM_ESCANEADO)).toBe(16500);
  });

  it('devolve null quando a ancora existe mas o numero nao vem colado', () => {
    expect(extractTotal('.. VALOR TOTAL Ri 2... 2.225,49')).toBeNull();
  });
});

describe('extractLooseTotal', () => {
  it('le o ultimo valor da linha ancorada, apesar do ruido do OCR', () => {
    expect(extractLooseTotal('.. VALOR TOTAL Ri 2... 2.225,49')).toBe(222549);
  });

  it('nao inventa total em linha sem ancora', () => {
    expect(extractLooseTotal('001 1260 COCA COLA 1 UN X 9,00 9,00')).toBeNull();
  });
});

describe('extractCity', () => {
  it('separa a cidade do bairro colado nela', () => {
    // "SERRINHA FORTALEZA-CE": SERRINHA e bairro, e so a ultima palavra e a
    // cidade — nao ha separador nenhum entre as duas no endereco impresso.
    expect(extractCity(CUPOM_ESCANEADO)).toBe('Fortaleza/CE');
  });

  it('mantem as palavras que fazem parte do nome da cidade', () => {
    expect(extractCity('Centro, Rio de Janeiro/RJ')).toBe('Rio De Janeiro/RJ');
    expect(extractCity('Av. Paulista, Sao Paulo-SP')).toBe('Sao Paulo/SP');
  });

  it('le endereco em caixa mista', () => {
    expect(extractCity('CEP: 62508-228 Fazendinha, Itapipoca /CE')).toBe(
      'Itapipoca/CE',
    );
  });

  it('ignora duas letras que nao sao UF', () => {
    expect(extractCity('Produto XPTO-ZZ')).toBeNull();
  });
});

describe('merchantName', () => {
  it('prefere a razao social colada no CNPJ a primeira linha da pagina', () => {
    // A primeira linha e a margem do papel lida pelo OCR. Era com ela que os
    // emitentes vinham sendo cadastrados.
    expect(merchantName(CUPOM_ESCANEADO)).toBe('CEA COMERCIO DE MLIMENTOS');
  });

  it('nao pula para a linha de endereco quando o CNPJ termina a linha', () => {
    // `\s*` depois do CNPJ engolia a quebra de linha e trazia o endereco.
    const texto = [
      'MERCEARIA FRANGUINHO NA PANELA LTDA',
      'CNPJ 26.048.802/0001-65',
      'Rua das Flores, 120 - Centro - Abadiania/GO',
    ].join('\n');

    expect(merchantName(texto)).toBe('MERCEARIA FRANGUINHO NA PANELA LTDA');
  });

  // Como o OCR devolveu a linha do CNPJ em 6 dos 11 cupons de Avare. Antes, o
  // nome virava a linha de endereco de baixo.
  const cnpjQuebrado = [
    'CNPJ: 11 .222.333/0001-81 CANTINA EXEMPLO',
    'CNPJ 11.222 333/0001-81 CANTINA EXEMPLO',
    'GNPJ: 11.222.333 /0001-81 CANTINA EXEMPLO',
    'CNPJ: 11 222.333/0001-81 CANTINA EXEMPLO',
  ];

  it.each(cnpjQuebrado)('le a razao social de %p', (linha) => {
    const texto = [
      'margem suja',
      linha,
      'RUA DAS PALMEIRAS, 100 CENTRO -',
      'CIDADE EXEMPLO - SP 18700-000',
    ].join('\n');

    expect(merchantName(texto)).toBe('CANTINA EXEMPLO');
  });

  it('usa a linha acima quando a do CNPJ so traz data e hora', () => {
    // Comprovante de maquininha: nome em cima, CNPJ com a data ao lado.
    const texto = [
      'VIA CLIENTE - COMPRA',
      'BAR DO EXEMPLO',
      'CNPJ: 11.222.333/0001-81 21/10/2026 + 22:03',
      'AV DAS PALMEIRAS, CENTRO',
      '| DEBITO R$ 200,00 |',
    ].join('\n');

    expect(merchantName(texto)).toBe('BAR DO EXEMPLO');
  });

  it('tira a data colada no fim da razao social da linha acima', () => {
    const texto = [
      'REDE',
      'CONPROV: 123456 VALOR: 96,53',
      'EXEMPLO E CIA LTDA  13,10,26-07:54',
      'CNPJ/CPF:11.222 .333/0001-81',
    ].join('\n');

    expect(merchantName(texto)).toBe('EXEMPLO E CIA LTDA');
  });

  it('nao toma o endereco acima do CNPJ por nome', () => {
    const texto = [
      'PADARIA ALFA',
      'RUA DAS PALMEIRAS, 100',
      'CNPJ: 11.222.333/0001-81',
    ].join('\n');

    expect(merchantName(texto)).toBe('PADARIA ALFA');
  });

  it('da o nome fixo ao recibo da Uber', () => {
    // A primeira linha com cara de nome era "Obrigado por viajar, Fulano", e
    // o piso de categoria punha a corrida em Alimentacao.
    const texto = ['Obrigado por viajar, Ana', 'Total R$ 6,95'].join('\n');

    expect(merchantName(texto)).toBe('Uber');
    expect(guessCategory(merchantName(texto))).toBe('transporte');
  });
});

describe('guessCategory', () => {
  // Tabela dos emitentes reais do caso-base. `null` e resposta legitima e
  // frequente: preencher sem certeza e preencher quando ha indicio, nao
  // sortear um tipo para nao deixar o campo vazio.
  const casos = [
    ['MATEUS SUPERMERCADOS S.A.', 'alimentacao'],
    ['Cearazim Bar, Restro e Pizzaria', 'alimentacao'],
    ['ESPETINHO DO RAIMUNDINHO', 'alimentacao'],
    ['POSTO MONTREAL JR', 'combustivel'],
    ['UBER DO BRASIL TECNOLOGIA', 'transporte'],
    ['LAVANDERIA CENTRAL', 'lavanderia'],
    ['ESTACIONAMENTO CENTRO LTDA', 'outros'],
    ['K B A TEIXEIRA COMERCIO E SERVICOS', null],
    ['GRUPO FARTURA DE HORTIFRUTI S A', null],
    ['', null],
  ];

  it.each(casos)('%s -> %s', (nome, esperado) => {
    expect(guessCategory(nome)).toBe(esperado);
  });

  it('posto ganha de restaurante no nome composto', () => {
    // Posto de rodovia costuma trazer "lanchonete" no nome, e o que se compra
    // ali e combustivel.
    expect(guessCategory('POSTO E LANCHONETE BEIRA RIO')).toBe('combustivel');
  });
});
