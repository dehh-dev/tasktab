'use strict';

const {
  decodeText,
  detectDelimiter,
  parseCsv,
} = require('../../../src/services/rpa/csv');

describe('parseCsv', () => {
  it('mantem tudo como texto, inclusive o zero a esquerda do CPF', () => {
    expect(parseCsv('Nome,CPF\nAna,01234567890\n')).toEqual([
      ['Nome', 'CPF'],
      ['Ana', '01234567890'],
    ]);
  });

  it('le a quebra de linha dentro das aspas do titulo da pergunta', () => {
    const csv =
      '"Cidade-UF\n(Exemplo: Goiania-GO)",CEP\r\n"Avaré-SP",18700000\r\n';

    expect(parseCsv(csv)).toEqual([
      ['Cidade-UF\n(Exemplo: Goiania-GO)', 'CEP'],
      ['Avaré-SP', '18700000'],
    ]);
  });

  it('desfaz as aspas dobradas e mantem a virgula de dentro das aspas', () => {
    expect(parseCsv('a,b\n"Rua ""Sete"", 10",x\n')).toEqual([
      ['a', 'b'],
      ['Rua "Sete", 10', 'x'],
    ]);
  });

  it('guarda a celula vazia no meio e no fim da linha', () => {
    expect(parseCsv('a,b,c\n1,,\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', ''],
    ]);
  });

  it('le o ultimo registro sem quebra de linha no fim', () => {
    expect(parseCsv('a;b\n1;2', ';')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('detectDelimiter', () => {
  it.each([
    ['virgula do Google Sheets', 'Nome,CPF,Banco\n', ','],
    ['ponto e virgula do Excel em portugues', 'Nome;CPF;Banco\n', ';'],
    ['virgula dentro das aspas nao conta', '"Rua, 10";CPF;Banco\n', ';'],
  ])('reconhece a %s', (_, text, delimiter) => {
    expect(detectDelimiter(text)).toBe(delimiter);
  });
});

describe('decodeText', () => {
  it('le UTF-8 e tira o BOM', () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const buffer = Buffer.concat([bom, Buffer.from('Função;Avaré', 'utf8')]);

    expect(decodeText(buffer)).toBe('Função;Avaré');
  });

  it('cai para Windows-1252 quando o arquivo nao e UTF-8, como o do Excel', () => {
    // "Função" em Windows-1252: ç = 0xE7, ã = 0xE3.
    const buffer = Buffer.from([0x46, 0x75, 0x6e, 0xe7, 0xe3, 0x6f]);

    expect(decodeText(buffer)).toBe('Função');
  });
});
