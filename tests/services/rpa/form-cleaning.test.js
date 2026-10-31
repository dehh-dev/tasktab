'use strict';

const {
  parseDate,
  parseTimestamp,
  cleanCityState,
  matchBank,
  matchAccountType,
  matchPixType,
  cleanOperation,
  checkWorker,
  cleanResponse,
} = require('../../../src/services/rpa/form-cleaning');

// Os casos vem das respostas reais de Avare, com os dados trocados por
// sinteticos: so a forma do que foi digitado.
const LAUNCH = {
  city: 'Avaré',
  state: 'SP',
  starts_on: '2026-10-13',
  ends_on: '2026-11-30',
};

const BANKS = [
  { code: '237', short_name: 'BCO BRADESCO S.A.', name: 'Banco Bradesco S.A.' },
  { code: '260', short_name: 'NU PAGAMENTOS - IP', name: 'NU PAGAMENTOS S.A.' },
  {
    code: '655',
    short_name: 'BCO VOTORANTIM S.A.',
    name: 'Banco Votorantim S.A.',
  },
];

describe('parseDate', () => {
  it.each([
    ['dd/mm/aaaa do .csv', '13/10/2026', '2026-10-13'],
    ['dia e mes sem zero', '1/2/1990', '1990-02-01'],
    ['ano com dois digitos do seculo passado', '01/02/90', '1990-02-01'],
    ['ano com dois digitos deste seculo', '01/02/05', '2005-02-01'],
    ['ISO', '2026-10-13', '2026-10-13'],
    ['com hora junto', '13/10/2026 09:52:17', '2026-10-13'],
    ['celula de data do .xlsx', new Date(Date.UTC(2026, 9, 13)), '2026-10-13'],
    ['serial do Excel', 46308, '2026-10-13'],
  ])('le %s', (_, value, expected) => {
    expect(parseDate(value)).toBe(expected);
  });

  it.each([
    ['31 de fevereiro', '31/02/2026'],
    ['texto', 'ontem'],
    ['mes 13', '01/13/2026'],
  ])('marca como invalida a data %s', (_, value) => {
    expect(parseDate(value)).toEqual({ invalid: true });
  });

  it('vazio e nulo', () => {
    expect(parseDate('  ')).toBeNull();
    expect(parseDate(null)).toBeNull();
  });
});

describe('parseTimestamp', () => {
  it.each([
    ['texto do .csv', '13/10/2026 09:52:17', '2026-10-13T09:52:17-03:00'],
    ['serial do Excel', 46308.41162037037, '2026-10-13T09:52:44-03:00'],
    [
      'celula do .xlsx',
      new Date(Date.UTC(2026, 9, 13, 9, 52, 17)),
      '2026-10-13T09:52:17-03:00',
    ],
  ])('le o carimbo como %s, na hora de Brasilia', (_, value, expected) => {
    expect(parseTimestamp(value)).toBe(expected);
  });

  it('carimbo ilegivel fica nulo', () => {
    expect(parseTimestamp('sem data')).toBeNull();
  });
});

describe('cleanCityState', () => {
  it.each([
    ['espaco depois do hifen', 'Avaré- SP', 'Avaré-SP'],
    ['minuscula e sem acento', 'avare sp', 'Avaré-SP'],
    ['barra e maiuscula', 'AVARE/SP', 'Avaré-SP'],
    ['UF em minuscula', 'Itapipoca-Ce', 'Itapipoca-CE'],
    ['outra cidade em minuscula', 'botucatu-sp', 'Botucatu-SP'],
    [
      'nome composto em minuscula',
      'são josé dos campos - sp',
      'São José dos Campos-SP',
    ],
  ])('arruma %s', (_, value, expected) => {
    expect(cleanCityState(value, LAUNCH)).toEqual({
      value: expected,
      ok: true,
    });
  });

  it.each([
    ['sem UF', 'Avaré'],
    ['nome que termina em sigla de UF', 'Rio de Janeiro'],
    ['UF que nao existe', 'Avaré-XX'],
  ])('devolve como veio, sem ok, quando %s', (_, value) => {
    expect(cleanCityState(value, LAUNCH)).toEqual({ value, ok: false });
  });

  it('a cidade do lancamento so vale com a mesma UF', () => {
    expect(cleanCityState('avare-pr', LAUNCH).value).toBe('Avare-PR');
  });
});

describe('matchBank', () => {
  it.each([
    ['Banco Nubank', '260'],
    ['Mercado Pago', '323'],
    ['Caixa Economica Federal', '104'],
    ['Banco Santander Brasil S.A', '033'],
    ['Itaú', '341'],
    ['ITAU UNIBANCO', '341'],
    ['BANCO INTER', '077'],
    ['PagBank', '290'],
    ['0260', '260'],
    ['237 - Bradesco', '237'],
    ['Banco Votorantim S.A.', '655'],
  ])('%p vira %s', (value, code) => {
    expect(matchBank(value, BANKS)).toEqual({ code, ambiguous: null });
  });

  it('o ItauBank do formulario fica ambiguo entre o 341 e o 479', () => {
    expect(matchBank('Banco ItauBank S.A', BANKS)).toEqual({
      code: null,
      ambiguous: ['341', '479'],
    });
  });

  it('codigo que nao esta na lista e nome desconhecido ficam sem codigo', () => {
    expect(matchBank('999', BANKS).code).toBeNull();
    expect(matchBank('Banco Ficticio', BANKS).code).toBeNull();
  });
});

describe('tipo de conta, chave Pix e operacao', () => {
  it.each([
    ['Corrente', 'checking'],
    ['Conta Corrente', 'checking'],
    ['Poupança', 'savings'],
    ['Pagamento', 'payment'],
    ['Conta Salário', null],
  ])('tipo de conta %p', (value, expected) => {
    expect(matchAccountType(value)).toBe(expected);
  });

  it.each([
    ['CPF', 'cpf'],
    ['CELULAR', 'phone'],
    ['E-mail', 'email'],
    ['Chave aleatória', 'random'],
    ['CNPJ', 'cnpj'],
  ])('tipo de chave Pix %p', (value, expected) => {
    expect(matchPixType(value)).toBe(expected);
  });

  it.each([
    ['ponto', '.', '104', null],
    ['tipo de conta no lugar da operacao', 'Conta Corrente', '033', null],
    ['poupanca no lugar da operacao', 'Poupança', '104', null],
    ['codigo do proprio banco', '0260', '260', null],
    ['operacao da Caixa', '013', '104', '013'],
    ['operacao nova da Caixa', '1288', '104', '1288'],
    ['vazio', '', '104', null],
  ])('operacao: %s', (_, value, bank, expected) => {
    expect(cleanOperation(value, bank)).toBe(expected);
  });
});

describe('checkWorker', () => {
  const COMPLETE = {
    name: 'Maria da Conceicao',
    role: 'Assistente Administrativo',
    starts_on: '2026-10-13',
    cpf: '52998224725',
    rg: '123456789',
    rg_issued_on: '2015-03-02',
    birth_date: '1990-02-01',
    birth_place: 'Avaré-SP',
    pis: '12056412545',
    address: 'Rua Sintetica, 10',
    district: 'Centro',
    city: 'Avaré-SP',
    cep: '18700000',
    mother_name: 'Joana da Conceicao',
    bank_name: 'Banco Nubank',
    bank_code: '260',
    agency: '0001',
    account: '1234567-8',
    account_type: 'checking',
  };

  const codes = (worker) =>
    checkWorker(worker, LAUNCH).map((entry) => `${entry.code}:${entry.field}`);

  it('cadastro completo e correto nao tem pendencia', () => {
    expect(checkWorker(COMPLETE, LAUNCH)).toEqual([]);
  });

  it.each([
    [
      'endereco sem numero',
      { address: 'Rua Sintetica' },
      'address_without_number:address',
    ],
    [
      'conta sem digito',
      { account: '12345678901' },
      'account_without_digit:account',
    ],
    ['conta com letra', { account: '12a45-6' }, 'account_format:account'],
    ['CPF com DV errado', { cpf: '52998224726' }, 'cpf_invalid:cpf'],
    ['PIS com DV errado', { pis: '12056412546' }, 'pis_invalid:pis'],
    [
      'inicio antes do lancamento',
      { starts_on: '2026-08-05' },
      'start_before_launch:starts_on',
    ],
    [
      'inicio depois do lancamento',
      { starts_on: '2026-12-01' },
      'start_after_launch:starts_on',
    ],
    [
      'inicio igual ao nascimento',
      { starts_on: '2026-10-13', birth_date: '2026-10-13' },
      'start_equals_birth:starts_on',
    ],
    ['banco fora da lista', { bank_code: null }, 'bank_unknown:bank_code'],
    ['mae em branco', { mother_name: null }, 'missing_field:mother_name'],
  ])('aponta %s', (_, change, expected) => {
    expect(codes({ ...COMPLETE, ...change })).toEqual([expected]);
  });

  it.each([
    ['s/n no endereco', { address: 'Sitio Sintetico, s/n' }],
    ['sem pai', { father_name: null }],
    ['sem chave Pix', { pix_key: null }],
    ['conta com X no digito', { account: '1234567-X' }],
  ])('aceita %s', (_, change) => {
    expect(codes({ ...COMPLETE, ...change })).toEqual([]);
  });

  it('pula o campo que ja tem nota da limpeza', () => {
    const issues = checkWorker(
      { ...COMPLETE, birth_date: null },
      LAUNCH,
      new Set(['birth_date']),
    );

    expect(issues).toEqual([]);
  });
});

describe('cleanResponse', () => {
  // Uma resposta como a planilha de Avare entrega: o CPF e a agencia viraram
  // numero, a operacao recebeu o tipo de conta e o RG e o proprio CPF (o RG
  // novo do Ceara usa o numero do CPF, e isso nao e erro).
  const RESPONSE = {
    form_submitted_at: '13/10/2026 09:52:17',
    name: 'maria da conceição sintética',
    role: 'Assistente Administrativo',
    starts_on: '13/10/2026',
    cpf: 1234567890,
    rg: 1234567890,
    rg_issued_on: '02/03/2015',
    birth_date: '01/02/1990',
    birth_place: 'Itapipoca-Ce',
    pis: '1234567897',
    address: 'Rua Sintetica, 94',
    district: 'Boa Vista',
    city: 'avare sp',
    cep: 18700000,
    mother_name: 'JOANA DA CONCEIÇÃO',
    father_name: '',
    bank_name: 'Banco Nubank',
    agency: 1,
    bank_operation: 'Conta Corrente',
    account: '1234567-8',
    account_type: 'Corrente',
    pix_key_type: 'CPF',
    pix_key: 1234567890,
  };

  it('limpa a resposta e anota o que foi completado', () => {
    const { worker, issues } = cleanResponse(RESPONSE, {
      launch: LAUNCH,
      banks: BANKS,
    });

    expect(worker).toMatchObject({
      name: 'Maria da Conceição Sintética',
      cpf: '01234567890',
      rg: '1234567890',
      starts_on: '2026-10-13',
      birth_date: '1990-02-01',
      birth_place: 'Itapipoca-CE',
      city: 'Avaré-SP',
      pis: '01234567897',
      cep: '18700000',
      mother_name: 'Joana da Conceição',
      father_name: null,
      bank_code: '260',
      agency: '0001',
      bank_operation: null,
      account_type: 'checking',
      pix_key_type: 'cpf',
      form_submitted_at: '2026-10-13T09:52:17-03:00',
      dependents: 0,
    });
    expect(issues.map((entry) => entry.code)).toEqual([
      'cpf_padded',
      'pis_padded',
    ]);
    expect(issues.every((entry) => entry.resolved === false)).toBe(true);
  });

  it('CPF de 11 digitos com DV errado entra, com pendencia', () => {
    const { worker, issues } = cleanResponse(
      { ...RESPONSE, cpf: '529.982.247-26' },
      { launch: LAUNCH, banks: BANKS },
    );

    expect(worker.cpf).toBe('52998224726');
    expect(issues.map((entry) => entry.code)).toContain('cpf_invalid');
  });

  it('data ilegivel vira nota, e nao tambem "nao preenchida"', () => {
    const { issues } = cleanResponse(
      { ...RESPONSE, birth_date: 'primeiro de fevereiro' },
      { launch: LAUNCH, banks: BANKS },
    );

    expect(
      issues.filter((entry) => entry.field === 'birth_date').map((e) => e.code),
    ).toEqual(['date_invalid']);
  });

  it('o ItauBank fica sem codigo e com nota de banco ambiguo', () => {
    const { worker, issues } = cleanResponse(
      { ...RESPONSE, bank_name: 'Banco ItauBank S.A' },
      { launch: LAUNCH, banks: BANKS },
    );

    expect(worker.bank_code).toBeNull();
    expect(
      issues.filter((entry) => entry.field === 'bank_code').map((e) => e.code),
    ).toEqual(['bank_ambiguous']);
  });

  it.each([
    ['sem nome', { name: '  ' }, 'resposta sem nome'],
    ['sem CPF', { cpf: '' }, 'resposta sem CPF'],
    [
      'CPF que nao fecha nem completado',
      { cpf: '1234567891' },
      'CPF sem 11 digitos',
    ],
  ])('recusa a linha %s', (_, change, reason) => {
    expect(
      cleanResponse(
        { ...RESPONSE, ...change },
        { launch: LAUNCH, banks: BANKS },
      ),
    ).toEqual({ rejected: reason });
  });
});
