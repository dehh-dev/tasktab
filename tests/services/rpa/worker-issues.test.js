'use strict';

const { reconcileIssues } = require('../../../src/services/rpa/worker-issues');

const LAUNCH = { starts_on: '2026-10-13', ends_on: '2026-11-30' };

// So os campos que as verificacoes olham; o resto vem preenchido para nao
// aparecer "nao foi preenchido".
const WORKER = {
  name: 'Pessoa Sintetica',
  role: 'Assistente Administrativo',
  starts_on: '2026-10-13',
  cpf: '52998224725',
  rg: '123456789',
  rg_issued_on: '2015-03-02',
  birth_date: '1990-02-01',
  birth_place: 'Avaré-SP',
  pis: '12056412545',
  address: 'Rua Sintetica',
  district: 'Centro',
  city: 'Avaré-SP',
  cep: '18700000',
  mother_name: 'Mae Sintetica',
  bank_name: 'Banco Nubank',
  bank_code: '260',
  agency: '0001',
  account: '1234567-8',
  account_type: 'checking',
};

const note = (code, field, extra = {}) => ({
  code,
  field,
  message: '',
  source: 'form',
  resolved: false,
  ...extra,
});

const codes = (issues) =>
  issues.map((entry) => `${entry.code}:${entry.field}:${entry.resolved}`);

describe('reconcileIssues', () => {
  it('mantem a nota do campo que nao mudou e recalcula as verificacoes', () => {
    const issues = reconcileIssues({
      previous: [note('cpf_padded', 'cpf')],
      merged: WORKER,
      launch: LAUNCH,
      changed: new Set(['dependents']),
    });

    expect(codes(issues)).toEqual([
      'cpf_padded:cpf:false',
      'address_without_number:address:false',
    ]);
  });

  it('tira a nota do campo que mudou, e poe a nova quando ha', () => {
    const issues = reconcileIssues({
      previous: [note('bank_ambiguous', 'bank_code')],
      merged: { ...WORKER, address: 'Rua Sintetica, 1' },
      launch: LAUNCH,
      changed: new Set(['bank_code']),
      notes: [note('pis_padded', 'pis'), note('date_invalid', 'bank_code')],
    });

    // A nota nova de um campo que nao mudou (`pis`) nao entra.
    expect(codes(issues)).toEqual(['date_invalid:bank_code:false']);
  });

  it('o resolvido fica enquanto o campo nao muda, e cai quando muda', () => {
    const previous = [
      {
        code: 'address_without_number',
        field: 'address',
        message: '',
        source: 'check',
        resolved: true,
      },
    ];

    const kept = reconcileIssues({
      previous,
      merged: WORKER,
      launch: LAUNCH,
      changed: new Set(['dependents']),
    });
    const reopened = reconcileIssues({
      previous,
      merged: { ...WORKER, address: 'Outra Rua Sem Numero' },
      launch: LAUNCH,
      changed: new Set(['address']),
    });

    expect(codes(kept)).toEqual(['address_without_number:address:true']);
    expect(codes(reopened)).toEqual(['address_without_number:address:false']);
  });

  it('marca como resolvida a que alguem acabou de conferir', () => {
    const issues = reconcileIssues({
      merged: WORKER,
      launch: LAUNCH,
      changed: new Set(),
      resolve: [{ code: 'address_without_number', field: 'address' }],
    });

    expect(codes(issues)).toEqual(['address_without_number:address:true']);
  });
});
