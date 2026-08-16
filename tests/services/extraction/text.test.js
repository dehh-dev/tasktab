'use strict';

const {
  hasUsefulText,
  MIN_USEFUL_CHARS,
} = require('../../../src/services/extraction/text.service');

/**
 * Aqui fica so a heuristica, que e pura. A leitura do PDF em si e exercitada
 * pelos testes de `tests/api/reports/receipts-extraction.test.js`, contra o
 * servidor de verdade: o `unpdf` carrega o pdf.js por import dinamico, e a VM
 * do Jest recusa isso sem `--experimental-vm-modules`. Ligar a flag para todo
 * o projeto sairia mais caro que cobrir a leitura por integracao, que e a
 * forma que este repositorio ja prefere.
 */
describe('hasUsefulText', () => {
  it('aceita um cupom de verdade', () => {
    const cupom = [
      'MERCEARIA FRANGUINHO NA PANELA LTDA',
      'CNPJ 26.048.802/0001-65',
      'VALOR TOTAL R$ 37,60',
    ].join(' ');

    expect(hasUsefulText(cupom)).toBe(true);
  });

  it('recusa o resquicio de texto de uma pagina escaneada', () => {
    // Cupom escaneado costuma trazer uma sobra: numero de pagina, marca do
    // scanner. Passaria em `texto !== ''` e iria para a rota digital, onde nao
    // ha o que extrair.
    expect(hasUsefulText('2')).toBe(false);
    expect(hasUsefulText('Scanned by CamScanner')).toBe(false);
  });

  it('nao conta pontuacao nem espaco como conteudo', () => {
    const so_pontuacao = '. - / $ , ; : ( ) '.repeat(20);

    expect(so_pontuacao.length).toBeGreaterThan(MIN_USEFUL_CHARS);
    expect(hasUsefulText(so_pontuacao)).toBe(false);
  });

  it('conta acentuacao como caractere util', () => {
    // \p{L} cobre acentuacao: "Alimentação" nao pode valer menos que
    // "Alimentacao" so por causa da cedilha.
    const comAcento = 'Alimentação e hospedagem em Abadiânia na terça-feira';

    expect(hasUsefulText(comAcento)).toBe(true);
  });

  it('trata entrada vazia sem estourar', () => {
    expect(hasUsefulText('')).toBe(false);
  });
});
