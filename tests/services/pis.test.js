'use strict';

const { normalize, isValid, recover } = require('../../src/validators/pis');

// Sinteticos, calculados pelo verificador: nenhum PIS de pessoa real.
const VALIDO = '12056412545';
const COM_ZERO = '01234567897';
const DOIS_ZEROS = '00012345679';

describe('isValid', () => {
  it.each([
    ['so digitos', VALIDO],
    ['com mascara', '120.56412.54-5'],
    ['numero de planilha', 17004034320],
    ['comecando com zero, como texto', COM_ZERO],
  ])('aceita %s', (_, pis) => {
    expect(isValid(pis)).toBe(true);
  });

  it.each([
    ['DV errado', '12056412546'],
    ['sequencia repetida', '22222222222'],
    ['zeros, que fecham o DV por acidente', '00000000000'],
    ['curto', '1205641254'],
    ['nulo', null],
  ])('recusa %s', (_, pis) => {
    expect(isValid(pis)).toBe(false);
  });
});

describe('normalize', () => {
  it('devolve so os digitos', () => {
    expect(normalize('120.56412.54-5')).toBe(VALIDO);
  });
});

describe('recover', () => {
  it('PIS de 10 digitos passa com zero a esquerda quando o DV fecha', () => {
    expect(recover('1234567897')).toEqual({ value: COM_ZERO, padded: true });
  });

  it('completa no maximo dois zeros', () => {
    expect(recover('012345679')).toEqual({ value: DOIS_ZEROS, padded: true });
    // 8 digitos: tres zeros perdidos ja e mais provavel um numero errado.
    expect(recover(12345679)).toBeNull();
  });

  it('10 digitos que nao fecham com zero continuam invalidos', () => {
    expect(recover('1205641254')).toBeNull();
  });

  it('devolve o PIS inteiro sem marcar como completado', () => {
    expect(recover(VALIDO)).toEqual({ value: VALIDO, padded: false });
  });
});
