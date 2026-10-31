'use strict';

const { mapHeader } = require('../../../src/services/rpa/form-columns');

// Os titulos das perguntas do formulario de Avare, com a quebra de linha e o
// exemplo como o Google Forms os grava. So os titulos: nenhuma resposta.
const AVARE = [
  'Carimbo de data/hora',
  'Endereço de e-mail',
  'Nome completo',
  'Função',
  'Data Inicio',
  'Nº CPF',
  'Nº RG',
  'Data Emissão RG',
  'Data Nascimento',
  'Local de Nascimento-UF\r\n(Exemplo: Goiania-GO)',
  'Nº PIS',
  'Endereço Completo\r\n(Exemplo: Rua João, 10)',
  'Bairro/Setor',
  'Cidade-UF\r\n(Exemplo: Goiania-GO)',
  'CEP',
  'Nome completo MÃE',
  'Nome Completo PAI',
  'Banco',
  'Agência',
  'Operação',
  'Nº Conta - Dígito\r\n(Exemplo: 1112222-3)',
  'Tipo de Conta',
  'Tipo de Chave PIX',
  'Chave PIX',
  'Anexar Documentos\r\nCarteira de Trabalho FRENTE (Lado de Foto)',
  'Anexar Documentos\r\nRG  ou CNH   FRENTE (Lado de Foto)',
  'Anexar Documentos\r\nComprovantes de ENDEREÇO',
  'Anexar Documentos\r\nDados Bancarios (Print ou Fotos',
];

describe('mapHeader', () => {
  it('reconhece cada pergunta do formulario de Avare e deixa os anexos de fora', () => {
    const { fields, unknown, repeated } = mapHeader(AVARE);

    expect(Object.values(fields)).toEqual([
      'form_submitted_at',
      'email',
      'name',
      'role',
      'starts_on',
      'cpf',
      'rg',
      'rg_issued_on',
      'birth_date',
      'birth_place',
      'pis',
      'address',
      'district',
      'city',
      'cep',
      'mother_name',
      'father_name',
      'bank_name',
      'agency',
      'bank_operation',
      'account',
      'account_type',
      'pix_key_type',
      'pix_key',
    ]);
    expect(unknown).toEqual([]);
    expect(repeated).toEqual([]);
  });

  it('casa pela pergunta, nao pela posicao nem pela caixa', () => {
    const { fields } = mapHeader(['CPF', 'NOME COMPLETO', 'cidade - uf']);

    expect(fields).toEqual({ 0: 'cpf', 1: 'name', 2: 'city' });
  });

  it('pergunta nova vira aviso, e a segunda coluna do mesmo campo tambem', () => {
    const { fields, unknown, repeated } = mapHeader([
      'Nome completo',
      'Tamanho da camiseta',
      'CPF',
      'Confirme o CPF',
    ]);

    expect(fields).toEqual({ 0: 'name', 2: 'cpf' });
    expect(unknown).toEqual(['Tamanho da camiseta']);
    expect(repeated).toEqual(['Confirme o CPF']);
  });

  it('ignora coluna sem titulo', () => {
    expect(mapHeader(['', null, 'CPF']).fields).toEqual({ 2: 'cpf' });
  });
});
