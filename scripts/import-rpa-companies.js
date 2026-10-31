'use strict';

/**
 * Cadastra ou atualiza as empresas do RPA a partir da aba EMPRESA da planilha
 * de controle de diarias.
 *
 *   npm run rpa:companies:import -- --file EMPRESA.xlsx
 *
 * Le `.xlsx`. A planilha de controle e `.xlsb`, que o `exceljs` nao abre:
 * salve-a como `.xlsx` no Excel antes. O arquivo fica na maquina de quem roda —
 * os dados das empresas nao entram no repositorio.
 *
 * Casa pelo codigo UAU: empresa nova e cadastrada, a existente e atualizada.
 * Tipo de servico e centro de custo so sobrescrevem quando a planilha os traz
 * (`Company.upsertByCode`). As regras de cada campo sao as da API; a linha que
 * nao passa e listada pelo numero, com o campo e o motivo.
 */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const db = require('../src/config/database');
const Company = require('../src/models/rpa-company.model');
const validator = require('../src/validators/rpa-company.validator');
const { ValidationError } = require('../infra/errors');

const USAGE = `
Uso: npm run rpa:companies:import -- --file <planilha.xlsx> [--sheet <aba>]

  --file <caminho>   obrigatorio; .xlsx com a aba EMPRESA
  --sheet <aba>      padrao: EMPRESA
`;

// Titulo da coluna na aba EMPRESA -> campo da API. Comparado sem acento,
// caixa nem espaco: "Tipo de Servico", "TIPO DE SERVIÇO" e "tipodeservico"
// sao a mesma coluna.
const COLUMNS = {
  codigo: 'code',
  nomeempresa: 'name',
  cnpj: 'cnpj',
  cidade: 'city',
  uf: 'state',
  tipodeservico: 'service_type',
  centrodecusto: 'cost_center',
};

const REQUIRED_COLUMNS = ['codigo', 'nomeempresa', 'cnpj'];

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith('--')) {
      args[argv[index].slice(2)] = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function fold(text) {
  return String(text)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** O valor que a celula mostra: formula pelo resultado, texto rico junto. */
function cellValue(cell) {
  const { value } = cell;

  if (value && typeof value === 'object') {
    if ('result' in value) return value.result ?? null;
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('');
    }
    if ('text' in value) return value.text;
  }

  return value ?? null;
}

function asText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/**
 * Uma linha da aba no formato da API. O CNPJ que o Excel guardou como numero
 * perde o zero a esquerda — 01.234.567/0001-89 vira 1234567000189 —, e volta
 * completado ate 14 digitos. Em texto, ele vai como esta.
 */
function rowToCompany(raw) {
  const company = {};

  for (const [field, value] of Object.entries(raw)) {
    if (field === 'code') {
      const code = typeof value === 'string' ? Number(value.trim()) : value;
      company.code = Number.isFinite(code) ? code : value;
    } else if (field === 'cnpj' && typeof value === 'number') {
      company.cnpj = String(value).padStart(14, '0');
    } else {
      company[field] = asText(value);
    }
  }

  return company;
}

async function isXlsb(buffer) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    return Boolean(zip.file('xl/workbook.bin'));
  } catch {
    return false;
  }
}

function fail(message) {
  process.stderr.write(`\n${message}\n${USAGE}\n`);
  process.exitCode = 1;
}

async function readSheet(file, sheetName) {
  const buffer = fs.readFileSync(file);

  if (await isXlsb(buffer)) {
    throw new Error(
      'O arquivo e .xlsb, que este script nao le. Abra no Excel e salve como .xlsx.',
    );
  }

  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new Error('O arquivo nao e uma planilha .xlsx legivel.');
  }

  const wanted = fold(sheetName);
  const sheet = workbook.worksheets.find((ws) => fold(ws.name) === wanted);

  if (!sheet) {
    const names = workbook.worksheets.map((ws) => ws.name).join(', ');
    throw new Error(`A planilha nao tem a aba ${sheetName} (abas: ${names}).`);
  }

  return sheet;
}

function mapHeader(sheet) {
  const header = {};

  sheet.getRow(1).eachCell((cell, column) => {
    const key = fold(cellValue(cell) ?? '');
    if (COLUMNS[key]) header[column] = COLUMNS[key];
  });

  const found = new Set(Object.values(header));
  const missing = REQUIRED_COLUMNS.filter((key) => !found.has(COLUMNS[key]));

  if (missing.length > 0) {
    throw new Error(
      `Faltam colunas na aba: ${missing.join(', ')}. A linha 1 tem de trazer os titulos da aba EMPRESA.`,
    );
  }

  return header;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.file) {
    return fail('Informe o arquivo com --file.');
  }

  const file = path.resolve(args.file);

  if (!fs.existsSync(file)) {
    return fail(`Arquivo nao encontrado: ${args.file}`);
  }

  let sheet;
  let header;

  try {
    sheet = await readSheet(file, args.sheet || 'EMPRESA');
    header = mapHeader(sheet);
  } catch (error) {
    return fail(error.message);
  }

  const counts = { inserted: 0, updated: 0 };
  const refused = [];

  for (let number = 2; number <= sheet.rowCount; number += 1) {
    const row = sheet.getRow(number);
    const raw = {};

    for (const [column, field] of Object.entries(header)) {
      raw[field] = cellValue(row.getCell(Number(column)));
    }

    // Linha em branco no fim da aba nao e erro.
    if (Object.values(raw).every((value) => asText(value) === null)) {
      continue;
    }

    try {
      const company = await Company.upsertByCode(
        validator.validateCreate(rowToCompany(raw)),
      );
      counts[company.inserted ? 'inserted' : 'updated'] += 1;
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;

      const reasons = error.details
        .map((detail) => `${detail.field}: ${detail.message}`)
        .join('; ');
      refused.push(`linha ${number}: ${reasons}`);
    }
  }

  process.stdout.write(
    `\nEmpresas cadastradas: ${counts.inserted}\n` +
      `Empresas atualizadas: ${counts.updated}\n` +
      `Linhas recusadas: ${refused.length}\n` +
      refused.map((line) => `  ${line}\n`).join(''),
  );

  // As validas ja entraram; o codigo de saida avisa que sobrou o que olhar.
  if (refused.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    process.stderr.write(`\nFalha ao importar: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => db.close());
