'use strict';

const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const db = require('../../config/database');
const Launch = require('../../models/rpa-launch.model');
const Worker = require('../../models/rpa-worker.model');
const Bank = require('../../models/rpa-bank.model');
const { ValidationError } = require('../../../infra/errors');
const { decodeText, parseCsv } = require('./csv');
const { mapHeader } = require('./form-columns');
const { cleanResponse, LABELS } = require('./form-cleaning');
const { reconcileIssues } = require('./worker-issues');

/**
 * Importacao da equipe a partir das respostas do Google Forms (issue 37).
 *
 * O arquivo chega em memoria e morre aqui: nao vai para o disco nem para o
 * banco. Fica so o que cada resposta vira na pessoa do lancamento.
 *
 * Reimportar casa pelo CPF. A resposta mais nova (pelo carimbo) atualiza so
 * os campos que mudaram e diz quais; ninguem duplica, e quem saiu do arquivo
 * continua no lancamento — a equipe so cresce por aqui.
 */

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ACTION =
  'Baixe as respostas do formulario como .xlsx ou .csv e envie de novo.';

function notSpreadsheet(message) {
  return new ValidationError({
    message,
    action: ACTION,
    details: [{ field: 'file', message }],
  });
}

/** O que a celula do .xlsx mostra: formula pelo resultado, link pelo texto. */
function cellValue(value) {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if ('result' in value) return value.result ?? null;
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('');
    }
    if ('text' in value) return value.text;
    if ('error' in value) return null;
  }

  return value ?? null;
}

async function readXlsx(buffer) {
  const zip = await JSZip.loadAsync(buffer).catch(() => null);

  if (zip && zip.file('xl/workbook.bin')) {
    throw notSpreadsheet(
      'O arquivo e .xlsb, que nao e lido. Salve como .xlsx ou baixe as respostas de novo.',
    );
  }

  if (!zip || !zip.file('xl/workbook.xml')) {
    throw notSpreadsheet('O arquivo nao e uma planilha .xlsx nem um .csv.');
  }

  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw notSpreadsheet('A planilha .xlsx nao pode ser lida.');
  }

  // O download do Forms tem uma aba so, a das respostas.
  const sheet = workbook.worksheets[0];
  const rows = [];

  sheet?.eachRow({ includeEmpty: true }, (row, number) => {
    rows[number - 1] = Array.from(row.values).slice(1).map(cellValue);
  });

  return Array.from(rows, (row) => row || []);
}

function readCsv(buffer) {
  // Texto nao tem byte nulo; PDF, imagem e executavel tem logo no comeco.
  if (buffer.subarray(0, 4096).includes(0)) {
    throw notSpreadsheet('O arquivo nao e uma planilha .xlsx nem um .csv.');
  }

  return parseCsv(decodeText(buffer));
}

/** Pelo conteudo, nunca pela extensao nem pelo content-type do envio. */
function readRows(buffer) {
  return buffer.subarray(0, 4).equals(ZIP_MAGIC)
    ? readXlsx(buffer)
    : readCsv(buffer);
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function instant(value) {
  if (!value) return null;
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

/** A resposta `a` e pelo menos tao nova quanto `b`? Sem carimbo, vale a ultima. */
function notOlder(a, b) {
  const [left, right] = [instant(a), instant(b)];
  return left === null || right === null || left >= right;
}

function sameValue(a, b) {
  return String(a ?? '') === String(b ?? '');
}

function missingColumns(present) {
  const missing = ['name', 'cpf'].filter((field) => !present.has(field));

  if (missing.length === 0) return;

  const labels = missing.map((field) => LABELS[field]);
  throw new ValidationError({
    message: `A planilha nao tem a pergunta de ${labels.join(' nem a de ')}.`,
    action:
      'Envie a planilha de respostas do formulario de cadastro, com os titulos das perguntas na primeira linha.',
    details: labels.map((label) => ({
      field: 'file',
      message: `falta a pergunta de ${label}`,
    })),
  });
}

/**
 * Le as respostas e escolhe uma por CPF: a de carimbo mais novo, ou a ultima
 * linha quando nao ha carimbo. As repetidas viram aviso pelo numero da linha
 * — o aviso nao leva o CPF.
 */
function parseResponses(rows, fields, context, warnings) {
  const rejected = [];
  const byCpf = new Map();

  rows.slice(1).forEach((row, index) => {
    const line = index + 2;
    const raw = {};

    for (const [column, field] of Object.entries(fields)) {
      raw[field] = row[Number(column)];
    }

    if (Object.values(raw).every(isBlank)) return;

    const result = cleanResponse(raw, context);

    if (result.rejected) {
      rejected.push({ line, reason: result.rejected });
      return;
    }

    const previous = byCpf.get(result.worker.cpf);
    const wins =
      !previous ||
      notOlder(
        result.worker.form_submitted_at,
        previous.worker.form_submitted_at,
      );

    if (previous) {
      warnings.push({
        column: null,
        message: `linhas ${previous.line} e ${line} sao da mesma pessoa: valeu a resposta mais nova (linha ${wins ? line : previous.line})`,
      });
    }

    if (wins) byCpf.set(result.worker.cpf, { line, ...result });
  });

  return { rejected, responses: [...byCpf.values()] };
}

/**
 * Os campos que a planilha traz, e so eles, entram na comparacao: uma planilha
 * sem a pergunta de dependentes nao pode zerar os dependentes de ninguem. O
 * codigo do banco vem junto com o nome do banco.
 */
function trackedFields(present) {
  const fields = [...present].filter((field) => field !== 'form_submitted_at');
  return present.has('bank_name') ? [...fields, 'bank_code'] : fields;
}

async function importResponses(launch, buffer) {
  const rows = await readRows(buffer);
  const { fields, unknown, repeated } = mapHeader(rows[0] || []);
  const present = new Set(Object.values(fields));

  missingColumns(present);

  const warnings = [
    ...unknown.map((title) => ({
      column: title,
      message: 'pergunta nao reconhecida: ficou de fora',
    })),
    ...repeated.map((title) => ({
      column: title,
      message: 'pergunta repetida: valeu a primeira',
    })),
  ];

  const context = { launch, banks: await Bank.findAll() };
  const { rejected, responses } = parseResponses(
    rows,
    fields,
    context,
    warnings,
  );
  const tracked = trackedFields(present);

  return db.transaction(async (client) => {
    // Duas importacoes do mesmo lancamento ao mesmo tempo dariam o mesmo
    // numero a duas pessoas.
    await Launch.lock(client, launch.id);

    const current = await Worker.findByLaunch(launch.id, client);
    const byCpf = new Map(current.map((worker) => [worker.cpf, worker]));
    let number = await Worker.nextNumber(client, launch.id);
    const counts = { created: 0, updated: 0, unchanged: 0 };
    const changes = [];

    for (const response of responses) {
      const existing = byCpf.get(response.worker.cpf);

      if (!existing) {
        await Worker.insert(client, launch.id, number, {
          ...response.worker,
          issues: response.issues,
        });
        number += 1;
        counts.created += 1;
        continue;
      }

      const changed = notOlder(
        response.worker.form_submitted_at,
        existing.form_submitted_at,
      )
        ? tracked.filter(
            (field) => !sameValue(response.worker[field], existing[field]),
          )
        : [];

      if (changed.length === 0) {
        counts.unchanged += 1;
        continue;
      }

      const data = {};
      for (const field of changed) data[field] = response.worker[field];

      data.issues = reconcileIssues({
        previous: existing.issues,
        merged: { ...existing, ...data },
        launch,
        changed: new Set(changed),
        notes: response.notes,
      });
      data.form_submitted_at =
        response.worker.form_submitted_at ?? existing.form_submitted_at;

      await Worker.update(existing.id, data, client);
      counts.updated += 1;
      changes.push({
        worker_id: existing.id,
        number: existing.number,
        fields: changed,
      });
    }

    const team = await Worker.findByLaunch(launch.id, client);

    return {
      ...counts,
      rejected,
      warnings,
      changes,
      workers: team.map(({ id, number: n, name, issues }) => ({
        id,
        number: n,
        name,
        issues,
      })),
    };
  });
}

module.exports = { importResponses };
