'use strict';

const {
  classify,
  accountName,
  detectType,
  matchWorker,
  folderName,
  documentFileName,
  uniqueName,
} = require('../../../src/services/rpa/documents');

const ROOT = 'Cadastro AVARE (File responses)';

describe('classify: o tipo e o lado pela pasta da pergunta', () => {
  it.each([
    [
      'Anexar Documentos Carteira de Trabalho FRENTE (Lado de Foto) (File responses)',
      { kind: 'ctps', side: 'front' },
    ],
    [
      'Anexar Documentos Carteira de Trabalho VERSO (Lado dos Dados) (File responses)',
      { kind: 'ctps', side: 'back' },
    ],
    [
      'Anexar Documentos RG  ou CNH   FRENTE (Lado de Foto) (File responses)',
      { kind: 'id_document', side: 'front' },
    ],
    [
      'Anexar Documentos RG  ou CNH  VERSO (Lado dos Dados) (File responses)',
      { kind: 'id_document', side: 'back' },
    ],
    [
      'Anexar Documentos Comprovantes de ENDEREÇO (File responses)',
      { kind: 'address_proof', side: null },
    ],
    [
      'Anexar Documentos Dados Bancarios (Print ou Fotos) (File responses)',
      { kind: 'bank_details', side: null },
    ],
    ['CTPS frente', { kind: 'ctps', side: 'front' }],
  ])('%s', (folder, expected) => {
    expect(classify(`${ROOT}/${folder}/IMG_0001 - Maria Silva.jpg`)).toEqual(
      expected,
    );
  });

  it('pasta de pergunta desconhecida, ou arquivo solto na raiz, e null', () => {
    expect(classify(`${ROOT}/Outra pergunta/x - Maria.jpg`)).toBeNull();
    expect(classify('IMG_0001 - Maria Silva.jpg')).toBeNull();
  });

  it('o nome do arquivo nao decide o tipo, so a pasta', () => {
    expect(
      classify(`${ROOT}/Outra pergunta/CTPS frente - Maria.jpg`),
    ).toBeNull();
  });
});

describe('accountName', () => {
  it.each([
    ['pasta/IMG_20261013_101010 - Maria Silva.jpg', 'Maria Silva'],
    ['pasta/conta de luz - outubro - João  Araújo.pdf', 'João Araújo'],
    ['pasta/sem conta.jpg', null],
    ['pasta/arquivo - .jpg', null],
  ])('%s -> %j', (path, expected) => {
    expect(accountName(path)).toBe(expected);
  });
});

describe('detectType: o formato pelo conteudo', () => {
  it.each([
    ['%PDF-1.7\n', 'application/pdf', 'pdf'],
    ['\xff\xd8\xff\xe0', 'image/jpeg', 'jpg'],
    ['\x89PNG\r\n\x1a\n', 'image/png', 'png'],
    ['RIFF\0\0\0\0WEBPVP8 ', 'image/webp', 'webp'],
    ['\0\0\0\x18ftypheic', 'image/heic', 'heic'],
  ])('%j', (head, contentType, extension) => {
    expect(detectType(Buffer.from(head, 'latin1'))).toEqual({
      contentType,
      extension,
    });
  });

  it('texto, planilha ou executavel com nome de foto nao passa', () => {
    expect(detectType(Buffer.from('nao e foto'))).toBeNull();
    expect(detectType(Buffer.from('PK\x03\x04', 'latin1'))).toBeNull();
  });
});

describe('matchWorker: primeiro e ultimo nome, sem acento e sem caixa', () => {
  const WORKERS = [
    { id: 1, name: 'Maria da Conceição Silva' },
    { id: 2, name: 'João Araújo' },
    { id: 3, name: 'Ana Souza' },
    { id: 4, name: 'Ana Maria Souza' },
  ];

  it.each([
    ['Maria Silva', 1],
    ['MARIA SILVA', 1],
    ['maria conceicao silva', 1],
    ['Joao Araujo', 2],
    // Duas pessoas com a mesma chave: ninguem escolhe sozinho.
    ['Ana Souza', null],
    ['Maria', null],
    ['Zé Ninguém', null],
    [null, null],
  ])('%j -> %j', (account, id) => {
    expect(matchWorker(account, WORKERS)?.id ?? null).toBe(id);
  });
});

describe('nomes no .zip de saida', () => {
  it('a pasta e NOME SOBRENOME, com acento', () => {
    expect(folderName('Maria da Conceição Araújo')).toBe('MARIA ARAÚJO');
  });

  it.each([
    [{ kind: 'ctps', side: 'front', extension: 'jpg' }, 'CTPS FRENTE.jpg'],
    [
      { kind: 'id_document', side: 'back', extension: 'png' },
      'RG-CNH VERSO.png',
    ],
    [{ kind: 'id_document', side: null, extension: 'jpg' }, 'RG-CNH.jpg'],
    [{ kind: 'address_proof', side: null, extension: 'pdf' }, 'CE.pdf'],
    [{ kind: 'bank_details', side: null, extension: 'jpg' }, 'DB.jpg'],
  ])('%j -> %s', (file, name) => {
    expect(documentFileName(file)).toBe(name);
  });

  it('nome repetido na mesma pasta ganha numero', () => {
    const used = new Set();
    expect(
      ['CE.pdf', 'CE.pdf', 'CE.pdf'].map((name) => uniqueName(name, used)),
    ).toEqual(['CE.pdf', 'CE (2).pdf', 'CE (3).pdf']);
  });
});
