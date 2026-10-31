'use strict';

const ExcelJS = require('exceljs');

/**
 * Respostas sinteticas do formulario de cadastro do RPA (issue 37).
 *
 * **Nenhuma resposta real e versionada**: o formulario traz CPF, RG, conta e
 * nome dos pais. Os titulos das perguntas sao os do formulario de Avare, com
 * a quebra de linha e o exemplo do jeito que o Google Forms grava; os
 * valores sao inventados, com CPF e PIS calculados pelo verificador.
 */
const TITLES = {
  form_submitted_at: 'Carimbo de data/hora',
  email: 'Endereço de e-mail',
  name: 'Nome completo',
  role: 'Função',
  starts_on: 'Data Inicio',
  cpf: 'Nº CPF',
  rg: 'Nº RG',
  rg_issued_on: 'Data Emissão RG',
  birth_date: 'Data Nascimento',
  birth_place: 'Local de Nascimento-UF\r\n(Exemplo: Goiania-GO)',
  pis: 'Nº PIS',
  address: 'Endereço Completo\r\n(Exemplo: Rua João, 10)',
  district: 'Bairro/Setor',
  city: 'Cidade-UF\r\n(Exemplo: Goiania-GO)',
  cep: 'CEP',
  mother_name: 'Nome completo MÃE',
  father_name: 'Nome Completo PAI',
  bank_name: 'Banco',
  agency: 'Agência',
  bank_operation: 'Operação',
  account: 'Nº Conta - Dígito\r\n(Exemplo: 1112222-3)',
  account_type: 'Tipo de Conta',
  pix_key_type: 'Tipo de Chave PIX',
  pix_key: 'Chave PIX',
};

const ATTACHMENT =
  'Anexar Documentos\r\nCarteira de Trabalho FRENTE (Lado de Foto)';

function cpfWithDv(base) {
  const digits = [...base].map(Number);
  for (const length of [9, 10]) {
    const sum = digits
      .slice(0, length)
      .reduce((total, digit, index) => total + digit * (length + 1 - index), 0);
    digits.push(((sum * 10) % 11) % 10);
  }
  return digits.join('');
}

function pisWithDv(base) {
  const weights = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = [...base].reduce(
    (total, digit, index) => total + Number(digit) * weights[index],
    0,
  );
  const remainder = sum % 11;
  return `${base}${remainder < 2 ? 0 : 11 - remainder}`;
}

/**
 * CPF sintetico de numero `seed`. Com `leadingZero`, comeca com 0 — o caso
 * que a planilha estraga ao guardar como numero.
 */
function syntheticCpf(seed, { leadingZero = false } = {}) {
  const base = `${leadingZero ? '0' : '3'}${String(seed).padStart(8, '7')}`;
  return cpfWithDv(base);
}

function syntheticPis(seed) {
  return pisWithDv(`1${String(seed).padStart(9, '5')}`);
}

/** Uma resposta completa e sem pendencia, com o `seed` nos campos unicos. */
function formResponse(seed, overrides = {}) {
  const cpf = syntheticCpf(seed);
  return {
    form_submitted_at: `13/10/2026 09:${String(seed).padStart(2, '0')}:00`,
    email: `pessoa${seed}@exemplo.test`,
    name: `Pessoa Sintetica Numero ${seed}`,
    role: 'Assistente Administrativo',
    starts_on: '13/10/2026',
    cpf,
    rg: `12345${seed}`,
    rg_issued_on: '02/03/2015',
    birth_date: '01/02/1990',
    birth_place: 'Avaré-SP',
    pis: syntheticPis(seed),
    address: `Rua Sintetica, ${seed}0`,
    district: 'Centro',
    city: 'Avaré-SP',
    cep: '18700000',
    mother_name: `Mae Sintetica ${seed}`,
    father_name: `Pai Sintetico ${seed}`,
    bank_name: 'Banco Nubank',
    agency: '0001',
    bank_operation: '',
    account: `123456${seed}-8`,
    account_type: 'Corrente',
    pix_key_type: 'CPF',
    pix_key: cpf,
    ...overrides,
  };
}

const DATE_FIELDS = ['starts_on', 'rg_issued_on', 'birth_date'];
const NUMERIC_FIELDS = ['cpf', 'rg', 'cep', 'agency', 'pix_key'];

/**
 * A celula como o Google Sheets a exporta: data como data, e o que so tem
 * digitos como numero — que e onde o zero a esquerda some.
 */
function asSheetsCell(field, value) {
  if (typeof value !== 'string') return value;

  const date = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}):(\d{2}))?$/.exec(
    value,
  );
  if ((DATE_FIELDS.includes(field) || field === 'form_submitted_at') && date) {
    const [, d, m, y, hh = 0, mi = 0, ss = 0] = date;
    return new Date(Date.UTC(y, m - 1, d, hh, mi, ss));
  }

  if (NUMERIC_FIELDS.includes(field) && /^\d+$/.test(value)) {
    return Number(value);
  }

  return value;
}

/**
 * O .xlsx das respostas. `columns` escolhe e ordena as perguntas; `extra`
 * acrescenta titulos no fim (pergunta nova, anexo), com celulas vazias.
 */
async function makeFormXlsx(
  responses,
  { columns = Object.keys(TITLES), extra = [ATTACHMENT], asSheets = true } = {},
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Respostas ao formulario 1');

  sheet.addRow([...columns.map((field) => TITLES[field]), ...extra]);

  for (const response of responses) {
    sheet.addRow(
      columns.map((field) =>
        asSheets
          ? asSheetsCell(field, response[field])
          : (response[field] ?? null),
      ),
    );
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function csvCell(value, delimiter) {
  const text = value === null || value === undefined ? '' : String(value);
  return /["\r\n]/.test(text) || text.includes(delimiter)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

/** O .csv das respostas, como o Sheets (UTF-8, virgula) ou o Excel (`;`). */
function makeFormCsv(
  responses,
  { columns = Object.keys(TITLES), delimiter = ',', encoding = 'utf8' } = {},
) {
  const lines = [
    columns.map((field) => csvCell(TITLES[field], delimiter)),
    ...responses.map((response) =>
      columns.map((field) => csvCell(response[field], delimiter)),
    ),
  ].map((cells) => cells.join(delimiter));

  return Buffer.from(`${lines.join('\r\n')}\r\n`, encoding);
}

module.exports = {
  TITLES,
  syntheticCpf,
  syntheticPis,
  formResponse,
  makeFormXlsx,
  makeFormCsv,
};
