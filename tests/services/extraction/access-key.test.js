'use strict';

const {
  parse,
  isValid,
  checkDigit,
} = require('../../../src/services/extraction/access-key');

// As quatro chaves reais do caso-base. CNPJ, numero da nota e DV conferidos.
const CHAVES = [
  {
    key: '52260626048802000165650010001631601303284889',
    cnpj: '26048802000165',
    number: 163160,
    dv: 9,
  },
  {
    key: '52260626048802000165650010001631191940931307',
    cnpj: '26048802000165',
    number: 163119,
    dv: 7,
  },
  {
    key: '52260620305961000111650010000078341000081451',
    cnpj: '20305961000111',
    number: 7834,
    dv: 1,
  },
  {
    key: '52260658080015000197650030001641801002927450',
    cnpj: '58080015000197',
    number: 164180,
    dv: 0,
  },
];

describe('checkDigit', () => {
  it.each(CHAVES)('fecha o DV da chave $cnpj/$number', ({ key, dv }) => {
    expect(checkDigit(key.slice(0, 43))).toBe(dv);
  });
});

describe('isValid', () => {
  it.each(CHAVES)('aceita a chave $cnpj/$number', ({ key }) => {
    expect(isValid(key)).toBe(true);
  });

  it('aceita a chave impressa em grupos de quatro', () => {
    const espacada = CHAVES[0].key.replace(/(\d{4})/g, '$1 ').trim();

    expect(isValid(espacada)).toBe(true);
  });

  it('recusa chave com um digito trocado', () => {
    // O caso que o DV existe para pegar: erro de OCR num digito so.
    const original = CHAVES[0].key;
    const trocado = `${original.slice(0, 20)}9${original.slice(21)}`;

    expect(trocado).not.toBe(original);
    expect(isValid(trocado)).toBe(false);
  });

  it('recusa chave com digitos adjacentes trocados de posicao', () => {
    const original = CHAVES[1].key;
    // Trocar dois digitos iguais nao muda a chave: procura o primeiro par
    // adjacente que de fato difere.
    const at = original
      .slice(0, 43)
      .split('')
      .findIndex((digit, index) => digit !== original[index + 1]);

    const trocado =
      original.slice(0, at) +
      original[at + 1] +
      original[at] +
      original.slice(at + 2);

    expect(trocado).not.toBe(original);
    // Com pesos consecutivos, a soma muda em (a - b), que nunca e multiplo de
    // 11 para digitos diferentes — entao o mod-11 pega toda troca adjacente.
    expect(isValid(trocado)).toBe(false);
  });

  it('recusa chave com tamanho errado', () => {
    expect(isValid(CHAVES[0].key.slice(0, 43))).toBe(false);
    expect(isValid(`${CHAVES[0].key}0`)).toBe(false);
  });

  it('recusa entrada que nao e chave', () => {
    expect(isValid('')).toBe(false);
    expect(isValid(null)).toBe(false);
    expect(isValid('26048802000165')).toBe(false);
  });
});

describe('parse', () => {
  it.each(CHAVES)(
    'le CNPJ e numero da chave $cnpj/$number',
    ({ key, cnpj, number, dv }) => {
      const parsed = parse(key);

      expect(parsed.cnpj).toBe(cnpj);
      expect(Number(parsed.number)).toBe(number);
      expect(parsed.checkDigit).toBe(dv);
    },
  );

  it('le o periodo de emissao embutido na chave', () => {
    const parsed = parse(CHAVES[0].key);

    // Posicoes 3 a 6: AAMM. A chave nao carrega o dia.
    expect(parsed.issuedYear).toBe(2026);
    expect(parsed.issuedMonth).toBe(6);
    expect(parsed.issuedPeriod).toBe('2026-06');
  });

  it('le modelo, serie e UF', () => {
    const parsed = parse(CHAVES[3].key);

    expect(parsed.uf).toBe('52');
    expect(parsed.model).toBe('65');
    expect(parsed.series).toBe('003');
  });

  it('devolve null para chave que nao fecha o DV', () => {
    // Aceitar os campos de uma chave invalida seria confiar num dado que a
    // propria norma diz estar errado.
    const original = CHAVES[2].key;
    const quebrada = `${original.slice(0, 43)}${(Number(original[43]) + 1) % 10}`;

    expect(parse(quebrada)).toBeNull();
  });
});
