'use strict';

const { normalize, isValid, plausible } = require('../../src/validators/cnpj');

// Exemplo oficial da Receita para o CNPJ alfanumerico.
const ALFA = '12ABC34501DE35';

describe('isValid', () => {
  it.each([
    ['numerico do caso-base', '26048802000165'],
    ['numerico com mascara', '26.048.802/0001-65'],
    ['alfanumerico da Receita', ALFA],
    ['alfanumerico com mascara', '12.ABC.345/01DE-35'],
    ['alfanumerico em minuscula', '12.abc.345/01de-35'],
  ])('aceita %s', (_, cnpj) => {
    expect(isValid(cnpj)).toBe(true);
  });

  it.each([
    ['DV errado', '12ABC34501DE36'],
    ['letra trocada', '12ABD34501DE35'],
    ['letra no DV', '12ABC34501DE3A'],
    ['sequencia repetida', '00000000000000'],
    ['curto', '12ABC34501DE3'],
  ])('recusa %s', (_, cnpj) => {
    expect(isValid(cnpj)).toBe(false);
  });
});

describe('normalize', () => {
  it('devolve maiuscula e sem mascara', () => {
    expect(normalize('12.abc.345/01de-35')).toBe(ALFA);
  });
});

describe('plausible', () => {
  it('palavra com o formato de CNPJ alfanumerico so passa se fechar o DV', () => {
    expect(plausible('SUPERMERCADO12')).toBe(false);
    expect(plausible(ALFA)).toBe(true);
  });

  it('so de digitos passa mesmo com DV errado, como erro de OCR', () => {
    expect(plausible('26048802000166')).toBe(true);
  });
});
