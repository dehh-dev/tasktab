'use strict';

const parsers = require('../../../src/services/extraction/parsers');
const { receiptLines } = require('../../fixtures/pdf');

const CHAVE = '52260626048802000165650010001631601303284889';

const NFCE = receiptLines({ total: '37,60', date: '19/06/2026' })
  .concat([`Chave de acesso ${CHAVE}`])
  .join('\n');

const UBER = [
  'Uber',
  'Obrigado por viajar, Ana',
  '23 de junho de 2026',
  'Total R$ 24,36',
  'Goiania - GO',
].join('\n');

const RECIBO = [
  'RECIBO',
  'Recebi de Fulano de Tal a importancia de',
  'CNPJ 58.080.015/0001-97',
  'Data: 21/06/2026',
  'Valor total 91,19',
].join('\n');

describe('resolve', () => {
  it('reconhece um cupom NFC-e', () => {
    expect(parsers.resolve(NFCE).name).toBe('nfce');
  });

  it('reconhece um recibo da Uber', () => {
    expect(parsers.resolve(UBER).name).toBe('uber');
  });

  it('nao reconhece emitente num recibo comum', () => {
    expect(parsers.resolve(RECIBO)).toBeNull();
  });
});

describe('parse', () => {
  it('cai no generico quando nenhum adaptador reconhece', () => {
    const { parser, fields } = parsers.parse(RECIBO);

    expect(parser).toBe('generic');
    expect(fields.amount_cents.value).toBe(9119);
    expect(fields.issued_at.value).toBe('2026-06-21');
    expect(fields.cnpj.value).toBe('58080015000197');
  });

  it('extrai a chave de acesso do cupom NFC-e', () => {
    const { parser, fields } = parsers.parse(NFCE);

    expect(parser).toBe('nfce');
    expect(fields.access_key.value).toBe(CHAVE);
    expect(fields.amount_cents.value).toBe(3760);
  });

  it('tira o CNPJ da chave, e nao do texto solto', () => {
    // O cupom traz o CNPJ da operadora do cartao impresso junto. A chave e a
    // fonte confiavel: posicoes 7 a 20.
    const comOperadora = `${NFCE}\nCREDENCIADORA CNPJ 01.027.058/0001-91`;
    const { fields } = parsers.parse(comOperadora);

    expect(fields.cnpj.value).toBe('26048802000165');
  });

  it('le a chave impressa em grupos de quatro', () => {
    const espacada = NFCE.replace(CHAVE, CHAVE.replace(/(\d{4})/g, '$1 '));
    const { fields } = parsers.parse(espacada);

    expect(fields.access_key.value).toBe(CHAVE);
  });

  it('entende a data por extenso da Uber', () => {
    const { parser, fields } = parsers.parse(UBER);

    expect(parser).toBe('uber');
    expect(fields.issued_at.value).toBe('2026-06-23');
    expect(fields.amount_cents.value).toBe(2436);
  });

  it('entende mes com acento', () => {
    const comAcento = UBER.replace('junho', 'março');
    const { fields } = parsers.parse(comAcento);

    expect(fields.issued_at.value).toBe('2026-03-23');
  });

  it('o adaptador especifico sobrescreve so o que sabe fazer melhor', () => {
    // O NFC-e nao le data; ela tem que continuar vindo do generico.
    const { parser, fields } = parsers.parse(NFCE);

    expect(parser).toBe('nfce');
    expect(fields.issued_at.value).toBe('2026-06-19');
    expect(fields.issued_at.confidence).toBeLessThan(
      fields.amount_cents.confidence,
    );
  });

  it('devolve campos vazios para texto vazio', () => {
    expect(parsers.parse('')).toEqual({ parser: null, fields: {} });
    expect(parsers.parse(null)).toEqual({ parser: null, fields: {} });
  });

  it('todo campo traz value, source e confidence', () => {
    const { fields } = parsers.parse(NFCE);

    for (const field of Object.values(fields)) {
      expect(field).toEqual({
        value: expect.anything(),
        source: expect.any(String),
        confidence: expect.any(Number),
      });
    }
  });
});
