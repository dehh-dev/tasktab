'use strict';

const cpfRules = require('../../validators/cpf');
const pisRules = require('../../validators/pis');
const { isValidIsoDate, STATES } = require('../../validators/rules');
const { squish, fold, smartCase } = require('./text');

/**
 * Da resposta do formulario a pessoa do lancamento: limpeza e pendencias.
 *
 * Funcoes puras — recebem a celula e o contexto (lancamento e lista de
 * bancos) e devolvem dado. A tabela de casos esta em `tests/services/rpa/`.
 *
 * Duas familias de pendencia:
 *
 * - **notas da limpeza** (`notes`): o que so a resposta crua mostra — CPF que
 *   veio sem o zero a esquerda, data ilegivel, banco ambiguo. Saem da
 *   importacao e ficam ate alguem mexer naquele campo.
 * - **verificacoes** (`checkWorker`): o que o valor gravado mostra — DV,
 *   endereco sem numero, inicio antes do lancamento. Rodam de novo a cada
 *   PATCH, entao corrigir o campo apaga a pendencia sozinho.
 *
 * Nenhuma pendencia barra a importacao. O que barra e so a linha sem nome ou
 * sem CPF de 11 digitos: sem o CPF nao ha como reconhecer a pessoa ao
 * reimportar.
 */

// Brasil sem horario de verao desde 2019: o carimbo do formulario e hora de
// Brasilia sem fuso, e e so para ordenar respostas.
const FORM_OFFSET = '-03:00';

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 24 * 60 * 60 * 1000;

const LABELS = {
  name: 'nome',
  role: 'funcao',
  starts_on: 'data de inicio',
  cpf: 'CPF',
  rg: 'RG',
  rg_issued_on: 'data de emissao do RG',
  birth_date: 'data de nascimento',
  birth_place: 'local de nascimento',
  pis: 'PIS',
  address: 'endereco',
  district: 'bairro',
  city: 'cidade',
  cep: 'CEP',
  mother_name: 'nome da mae',
  bank_name: 'banco',
  agency: 'agencia',
  account: 'conta',
  account_type: 'tipo de conta',
};

// O que o RPA imprime e o financeiro precisa. Pai e chave Pix ficam de fora:
// nem todo mundo tem um ou outro.
const REQUIRED = Object.keys(LABELS);

/**
 * `source` diz de onde a pendencia veio: `form` e nota da limpeza da resposta,
 * `check` e verificacao do valor gravado. O PATCH recalcula as `check` e so
 * mantem as `form` dos campos que nao mudaram.
 */
function issue(source, code, field, message) {
  return { code, field, message, source, resolved: false };
}

function isBlank(value) {
  return value === null || value === undefined || squish(value) === '';
}

/** Texto aparado, ou null. Numero de celula vira texto como esta. */
function text(value) {
  if (isBlank(value)) return null;
  return squish(value);
}

function pad2(number) {
  return String(number).padStart(2, '0');
}

function isoFromUtc(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/**
 * Data da resposta em ISO, ou `{ invalid: true }` quando veio algo que nao e
 * data. Aceita a celula de data do .xlsx (o exceljs a entrega como `Date` em
 * UTC), o numero serial do Excel e o texto `dd/mm/aaaa` do .csv.
 */
function parseDate(value) {
  if (isBlank(value)) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? { invalid: true }
      : isoFromUtc(value);
  }

  if (typeof value === 'number') {
    return isoFromUtc(new Date(EXCEL_EPOCH_MS + Math.floor(value) * DAY_MS));
  }

  const raw = squish(value).split(' ')[0];
  let iso = null;
  const br = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(raw);

  if (br) {
    const [, day, month, year] = br;
    // Ano com dois digitos: 00-30 e deste seculo, o resto do anterior.
    const fullYear =
      year.length === 4
        ? year
        : String(
            Number(year) <= 30 ? 2000 + Number(year) : 1900 + Number(year),
          );
    iso = `${fullYear}-${pad2(month)}-${pad2(day)}`;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    iso = raw;
  }

  return iso && isValidIsoDate(iso) ? iso : { invalid: true };
}

/** O carimbo da resposta como instante, para saber qual e a mais nova. */
function parseTimestamp(value) {
  if (isBlank(value)) return null;

  let date;
  let time = '00:00:00';

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    date = isoFromUtc(value);
    time = value.toISOString().slice(11, 19);
  } else if (typeof value === 'number') {
    const ms = EXCEL_EPOCH_MS + Math.round(value * DAY_MS);
    date = isoFromUtc(new Date(ms));
    time = new Date(ms).toISOString().slice(11, 19);
  } else {
    const [datePart, timePart] = squish(value).split(' ');
    const parsed = parseDate(datePart);
    if (typeof parsed !== 'string') return null;
    date = parsed;
    if (timePart && /^\d{1,2}:\d{2}(:\d{2})?$/.test(timePart)) {
      const [hh, mm, ss = '00'] = timePart.split(':');
      time = `${pad2(hh)}:${mm}:${ss}`;
    }
  }

  return `${date}T${time}${FORM_OFFSET}`;
}

/**
 * "Cidade-UF" do jeito que o RPA imprime. `Avare- SP`, `avare sp` e
 * `AVARE/SP` viram `Avaré-SP` quando a cidade e a do lancamento — e o caso
 * de quase toda a equipe, e de onde sai a grafia com acento. Fora isso, a
 * cidade fica como veio, so com a caixa arrumada.
 *
 * Sem UF reconhecivel, devolve o texto como veio e `ok: false`.
 */
function cleanCityState(value, launch = {}) {
  const raw = text(value);
  if (raw === null) return { value: null, ok: true };

  const match =
    /^(.+?)\s*[-/,]\s*([A-Za-z]{2})$/.exec(raw) ||
    /^(.+?)\s+([A-Za-z]{2})$/.exec(raw);
  const state = match && match[2].toUpperCase();

  if (!match || !STATES.includes(state)) {
    return { value: raw, ok: false };
  }

  const sameAsLaunch =
    launch.city &&
    fold(match[1]) === fold(launch.city) &&
    state === launch.state;
  const city = sameAsLaunch ? squish(launch.city) : smartCase(match[1]);

  return { value: `${city}-${state}`, ok: true };
}

/**
 * Bancos que aparecem digitados de mil jeitos. O resto casa pelo codigo
 * ("260", "0260 - Nu") ou pelo nome da lista do Banco Central.
 *
 * "Banco ItauBank S.A" e o caso que obrigou a lista: e uma opcao do
 * formulario de Avare, e e outro banco (479) — quem a escolhe quase sempre
 * tem conta no Itau Unibanco (341). Fica como ambiguo, para alguem conferir.
 */
const BANK_ALIASES = [
  [/itaubank/, null, ['341', '479']],
  [/\bitau\b/, '341'],
  [/\bnubank\b|\bnu pagamentos\b|^nu$/, '260'],
  [/mercado ?pago/, '323'],
  [/\bcaixa\b|\bcef\b/, '104'],
  [/santander/, '033'],
  [/bradesco/, '237'],
  [/banco do brasil|^bb$/, '001'],
  [/\binter\b/, '077'],
  [/\bc6\b/, '336'],
  [/picpay/, '380'],
  [/pagbank|pag ?seguro/, '290'],
  [/sicredi/, '748'],
  [/sicoob/, '756'],
  [/\bneon\b/, '536'],
  [/banrisul/, '041'],
  [/\boriginal\b/, '212'],
  [/\bbtg\b/, '208'],
  [/\bpan\b/, '623'],
  [/\bstone\b/, '197'],
  [/\bcora\b/, '403'],
  [/agibank/, '121'],
];

/**
 * `{ code, ambiguous }` do banco digitado. `code` nulo e banco nao
 * reconhecido; `ambiguous` traz os codigos possiveis quando ha mais de um.
 */
function matchBank(value, banks = []) {
  const raw = text(value);
  if (raw === null) return { code: null, ambiguous: null };

  const known = new Set(banks.map((bank) => bank.code));
  const typed = /^0*(\d{1,3})\b/.exec(raw);

  if (typed) {
    const code = typed[1].padStart(3, '0');
    if (known.has(code)) return { code, ambiguous: null };
  }

  const key = fold(raw);

  for (const [pattern, code, ambiguous] of BANK_ALIASES) {
    if (pattern.test(key)) {
      return { code, ambiguous: ambiguous || null };
    }
  }

  const byName = banks.find(
    (bank) => fold(bank.name) === key || fold(bank.short_name) === key,
  );

  return { code: byName ? byName.code : null, ambiguous: null };
}

const ACCOUNT_TYPES = [
  ['savings', /poupanca/],
  ['payment', /pagamento/],
  ['checking', /corrente/],
];

function matchAccountType(value) {
  const key = fold(value ?? '');
  const found = ACCOUNT_TYPES.find(([, pattern]) => pattern.test(key));
  return found ? found[0] : null;
}

const PIX_TYPES = [
  ['cpf', /\bcpf\b/],
  ['cnpj', /\bcnpj\b/],
  ['email', /e-?mail/],
  ['phone', /celular|telefone|fone/],
  ['random', /aleatori/],
];

function matchPixType(value) {
  const key = fold(value ?? '');
  const found = PIX_TYPES.find(([, pattern]) => pattern.test(key));
  return found ? found[0] : null;
}

/**
 * A operacao bancaria so faz sentido como numero (a da Caixa: 001, 013,
 * 1288). No formulario de Avare ela recebeu "Conta Corrente", "Poupanca" e
 * ate o codigo do banco ("0260" para o Nubank): isso sai como vazio.
 */
function cleanOperation(value, bankCode) {
  const raw = text(value);
  if (raw === null) return null;

  const digits = raw.replace(/\D/g, '');

  if (!/^[\d\s.-]+$/.test(raw) || digits === '' || digits.length > 4) {
    return null;
  }

  if (bankCode && Number(digits) === Number(bankCode)) {
    return null;
  }

  return digits;
}

/** So digitos, completando zeros a esquerda ate `length` quando era numero. */
function digitsOf(value, length) {
  const raw = text(value);
  if (raw === null) return null;

  const digits = raw.replace(/\D/g, '');
  if (digits === '') return null;

  return typeof value === 'number' ? digits.padStart(length, '0') : digits;
}

/**
 * Pendencias que o valor gravado mostra. Roda na importacao e de novo a
 * cada PATCH. `skip` sao os campos que ja tem uma nota da limpeza, mais
 * especifica — a data ilegivel nao precisa tambem de "nao preenchida".
 */
function checkWorker(worker, launch = {}, skip = new Set()) {
  const issues = [];
  const add = (code, field, message) => {
    if (!skip.has(field)) issues.push(issue('check', code, field, message));
  };

  for (const field of REQUIRED) {
    if (isBlank(worker[field])) {
      add('missing_field', field, `${LABELS[field]} nao foi preenchido`);
    }
  }

  if (worker.cpf && !cpfRules.isValid(worker.cpf)) {
    add('cpf_invalid', 'cpf', 'CPF com digito verificador invalido');
  }

  if (worker.pis && !pisRules.isValid(worker.pis)) {
    add('pis_invalid', 'pis', 'PIS com digito verificador invalido');
  }

  if (worker.starts_on) {
    if (launch.starts_on && worker.starts_on < launch.starts_on) {
      add(
        'start_before_launch',
        'starts_on',
        'inicio antes do comeco do lancamento',
      );
    } else if (launch.ends_on && worker.starts_on > launch.ends_on) {
      add(
        'start_after_launch',
        'starts_on',
        'inicio depois do fim do lancamento',
      );
    }

    if (worker.starts_on === worker.birth_date) {
      add(
        'start_equals_birth',
        'starts_on',
        'data de inicio igual a de nascimento',
      );
    }
  }

  if (worker.address && !/\d|\bs\/?n\b/i.test(worker.address)) {
    add('address_without_number', 'address', 'endereco sem numero');
  }

  if (worker.account) {
    const account = worker.account.replace(/[\s.]/g, '');

    if (/^\d+$/.test(account)) {
      add(
        'account_without_digit',
        'account',
        'conta sem o digito separado por hifen, como 1112222-3',
      );
    } else if (!/^\d+-[\dxX]$/.test(account)) {
      add('account_format', 'account', 'conta fora do formato numero-digito');
    }
  }

  if (worker.bank_name && !worker.bank_code) {
    add(
      'bank_unknown',
      'bank_code',
      'banco nao reconhecido na lista do Banco Central',
    );
  }

  if (worker.cep && !/^\d{8}$/.test(worker.cep)) {
    add('cep_invalid', 'cep', 'CEP deve ter 8 digitos');
  }

  return issues;
}

/**
 * Uma resposta do formulario (`{ campo: celula }`, ja mapeada pelo titulo)
 * como pessoa do lancamento.
 *
 * Devolve `{ worker, notes, issues }`, ou `{ rejected }` com o motivo quando
 * a linha nao tem como entrar.
 */
function cleanResponse(raw, { launch = {}, banks = [] } = {}) {
  const notes = [];
  const note = (code, field, message) =>
    notes.push(issue('form', code, field, message));

  const name = text(raw.name);
  if (name === null) {
    return { rejected: 'resposta sem nome' };
  }

  const cpf = cpfRules.recover(raw.cpf);
  const cpfDigits = digitsOf(raw.cpf, 11);
  let cpfValue;

  if (cpf) {
    cpfValue = cpf.value;
    if (cpf.padded) {
      note(
        'cpf_padded',
        'cpf',
        'CPF completado com zero a esquerda: a planilha o guardou como numero',
      );
    }
  } else if (cpfDigits && cpfDigits.length === 11) {
    // DV errado entra, como pendencia: e a mesma pessoa que vai corrigir.
    cpfValue = cpfDigits;
  } else {
    return { rejected: cpfDigits ? 'CPF sem 11 digitos' : 'resposta sem CPF' };
  }

  const worker = {
    name: smartCase(name),
    cpf: cpfValue,
    email: text(raw.email)?.toLowerCase() ?? null,
    role: text(raw.role),
    rg: text(raw.rg),
    address: text(raw.address),
    district: text(raw.district),
    mother_name: text(raw.mother_name) && smartCase(raw.mother_name),
    father_name: text(raw.father_name) && smartCase(raw.father_name),
    bank_name: text(raw.bank_name),
    agency: text(raw.agency),
    account: text(raw.account),
    pix_key: text(raw.pix_key),
    form_submitted_at: parseTimestamp(raw.form_submitted_at),
  };

  if (typeof raw.agency === 'number') {
    worker.agency = String(raw.agency).padStart(4, '0');
  }

  for (const field of ['starts_on', 'rg_issued_on', 'birth_date']) {
    const parsed = parseDate(raw[field]);
    worker[field] = typeof parsed === 'string' ? parsed : null;
    if (parsed && parsed.invalid) {
      note('date_invalid', field, `${LABELS[field]} ilegivel na resposta`);
    }
  }

  for (const field of ['city', 'birth_place']) {
    const cleaned = cleanCityState(raw[field], launch);
    worker[field] = cleaned.value;
    if (!cleaned.ok) {
      note(
        'city_without_state',
        field,
        `${LABELS[field]} sem a UF, como Avare-SP`,
      );
    }
  }

  const pis = pisRules.recover(raw.pis);
  if (pis) {
    worker.pis = pis.value;
    if (pis.padded) {
      note(
        'pis_padded',
        'pis',
        'PIS completado com zero a esquerda: o verificador fecha com ele',
      );
    }
  } else {
    const digits = digitsOf(raw.pis, 11);
    worker.pis = digits && digits.length === 11 ? digits : null;
    if (digits && digits.length !== 11) {
      note('pis_invalid', 'pis', 'PIS sem 11 digitos');
    }
  }

  const cep = digitsOf(raw.cep, 8);
  worker.cep = cep && cep.length === 8 ? cep : null;
  if (cep && cep.length !== 8) {
    note('cep_invalid', 'cep', 'CEP deve ter 8 digitos');
  }

  const bank = matchBank(raw.bank_name, banks);
  worker.bank_code = bank.code;
  if (bank.ambiguous) {
    note(
      'bank_ambiguous',
      'bank_code',
      `banco ambiguo: pode ser ${bank.ambiguous.join(' ou ')}; confira pela agencia`,
    );
  }

  worker.bank_operation = cleanOperation(raw.bank_operation, bank.code);

  worker.account_type = matchAccountType(raw.account_type);
  if (!isBlank(raw.account_type) && !worker.account_type) {
    note(
      'account_type_unknown',
      'account_type',
      'tipo de conta nao reconhecido',
    );
  }

  worker.pix_key_type = matchPixType(raw.pix_key_type);

  const dependents = Number(text(raw.dependents) ?? 0);
  worker.dependents =
    Number.isInteger(dependents) && dependents >= 0 ? dependents : 0;

  const skip = new Set(notes.map((entry) => entry.field));
  const issues = [...notes, ...checkWorker(worker, launch, skip)];

  return { worker, notes, issues };
}

module.exports = {
  LABELS,
  parseDate,
  parseTimestamp,
  cleanCityState,
  matchBank,
  matchAccountType,
  matchPixType,
  cleanOperation,
  checkWorker,
  cleanResponse,
};
