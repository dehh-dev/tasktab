'use strict';

const { normalize, isValid, recover } = require('../../src/validators/cpf');

// Todos sinteticos, calculados pelo verificador: nenhum CPF de pessoa real.
const VALIDO = '52998224725';
const COM_ZERO = '01234567890';
const DOIS_ZEROS = '00123456797';

describe('isValid', () => {
  it.each([
    ['so digitos', VALIDO],
    ['com mascara', '529.982.247-25'],
    ['com espacos', ' 529 982 247 25 '],
    ['numero de planilha com 11 digitos', 11144477735],
    ['comecando com zero, como texto', COM_ZERO],
  ])('aceita %s', (_, cpf) => {
    expect(isValid(cpf)).toBe(true);
  });

  it.each([
    ['primeiro DV errado', '52998224735'],
    ['segundo DV errado', '52998224726'],
    ['sequencia repetida', '11111111111'],
    ['zeros', '00000000000'],
    ['curto', '5299822472'],
    ['longo', '529982247250'],
    ['vazio', ''],
    ['nulo', null],
    ['objeto', {}],
  ])('recusa %s', (_, cpf) => {
    expect(isValid(cpf)).toBe(false);
  });
});

describe('normalize', () => {
  it('devolve so os digitos', () => {
    expect(normalize('529.982.247-25')).toBe(VALIDO);
  });

  it('nao completa zeros: 10 digitos nao sao CPF', () => {
    expect(normalize('1234567890')).toBeNull();
  });
});

describe('recover', () => {
  it.each([
    ['numero que perdeu um zero', 1234567890, COM_ZERO],
    ['numero que perdeu dois zeros', 123456797, DOIS_ZEROS],
    ['texto que perdeu um zero', '1234567890', COM_ZERO],
  ])('completa o %s quando o verificador fecha', (_, entrada, esperado) => {
    expect(recover(entrada)).toEqual({ value: esperado, padded: true });
  });

  it('devolve o CPF inteiro sem marcar como completado', () => {
    expect(recover('529.982.247-25')).toEqual({
      value: VALIDO,
      padded: false,
    });
  });

  it.each([
    ['digito a menos que nao fecha com zero', '5299822472'],
    ['oito digitos', '12345678'],
    ['DV errado', '52998224726'],
  ])('nao inventa CPF a partir de %s', (_, entrada) => {
    expect(recover(entrada)).toBeNull();
  });
});
