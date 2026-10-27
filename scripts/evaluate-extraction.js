'use strict';

/**
 * Taxa de acerto da extracao, medida contra o que uma pessoa confirmou.
 *
 *   npm run extraction:evaluate -- --report 93
 *
 * Compara, campo a campo, o que a extracao propos (`receipts.extracted`) com o
 * valor confirmado na revisao, no total e por tipo de documento (origem e
 * parser). Com `--reextract`, a proposta e a do codigo de hoje: o PDF de cada
 * comprovante e lido de novo, sem gravar nada. E a medida de antes e depois
 * de qualquer mudanca na extracao, inclusive nos relatorios confirmados antes
 * de a proposta ser guardada: sem ela, uma regra nova so podia ser julgada
 * relendo o `raw_text` a mao.
 *
 * Imprime **so contagens**. O comprovante traz CNPJ e as vezes CPF de
 * terceiros: nenhum valor, texto ou chave lido sai daqui.
 */

const fs = require('fs/promises');
const path = require('path');
const db = require('../src/config/database');
const env = require('../src/config/env');
const Receipt = require('../src/models/receipt.model');
const pipeline = require('../src/services/extraction/pipeline.service');
const ocrService = require('../src/services/extraction/ocr.service');

const USAGE = `
Uso: npm run extraction:evaluate -- [opcoes]

  --report <id>   so este relatorio (padrao: todos)
  --reextract     le os PDFs de novo com o codigo de hoje, sem gravar nada
  --json          saida em JSON, para comparar execucoes
`;

const FIELDS = {
  issued_at: 'data',
  amount_cents: 'valor',
  access_key: 'chave',
  category: 'categoria',
};

// Abaixo disto a revisao destaca o comprovante como de baixa confianca
// (`LOW_CONFIDENCE` em `web/src/components/ReceiptReview.jsx`). Erro com
// confianca maior chega a pessoa sem destaque: e o erro que mais custa.
const HIGHLIGHT_BELOW = 0.7;

function parseArgs(argv) {
  const args = {
    json: argv.includes('--json'),
    reextract: argv.includes('--reextract'),
    report: null,
  };
  const index = argv.indexOf('--report');

  if (index !== -1) {
    const id = Number(argv[index + 1]);
    args.report = Number.isInteger(id) && id > 0 ? id : NaN;
  }

  return args;
}

function emptyCounts() {
  return Object.fromEntries(
    Object.keys(FIELDS).map((field) => [
      field,
      { right: 0, wrong: 0, empty: 0, wrong_unflagged: 0 },
    ]),
  );
}

/**
 * O erro que a revisao nao destaca: a categoria sem a marca de palpite, e os
 * outros campos com a confianca do comprovante acima do destaque.
 */
function unflagged(field, proposal) {
  if (field === 'category') {
    return proposal.category_guessed !== true;
  }

  return Number(proposal.confidence ?? 0) >= HIGHLIGHT_BELOW;
}

function tally(counts, receipt) {
  const proposal = receipt.extracted;

  for (const field of Object.keys(FIELDS)) {
    const proposed = proposal[field] ?? null;
    const confirmed = receipt[field] ?? null;

    // Sem chave no papel e sem chave proposta nao ha o que medir.
    if (proposed === null && confirmed === null) {
      continue;
    }

    const slot = counts[field];

    if (proposed === confirmed) {
      slot.right += 1;
    } else if (proposed === null) {
      slot.empty += 1;
    } else {
      slot.wrong += 1;

      if (unflagged(field, proposal)) {
        slot.wrong_unflagged += 1;
      }
    }
  }
}

/**
 * Troca a proposta guardada pela que o codigo de hoje faz, lendo de novo o
 * PDF de cada comprovante. Nada e gravado: nem o comprovante, nem emitente
 * novo. Arquivo que saiu do disco fica sem proposta.
 */
async function reextract(receipts) {
  const fresh = [];

  for (const [filePath, pages] of Map.groupBy(receipts, (r) => r.file_path)) {
    const buffer = await fs
      .readFile(path.join(env.upload.dir, filePath))
      .catch((error) => {
        if (error.code === 'ENOENT') {
          return null;
        }
        throw error;
      });
    const proposals = buffer
      ? await pipeline.proposeFile({ buffer, receipts: pages })
      : new Map();

    for (const receipt of pages) {
      fresh.push({ ...receipt, extracted: proposals.get(receipt.id) ?? null });
    }
  }

  return fresh;
}

function evaluate(receipts, mode) {
  const measured = receipts.filter((receipt) => receipt.extracted !== null);
  const result = {
    mode,
    confirmed: receipts.length,
    without_proposal: receipts.length - measured.length,
    total: emptyCounts(),
    by_source: {},
    by_parser: {},
  };

  for (const receipt of measured) {
    const source = receipt.extracted.extraction_source ?? 'nada_lido';
    const parser = receipt.extracted.parser ?? 'nenhum';

    result.by_source[source] ??= emptyCounts();
    result.by_parser[parser] ??= emptyCounts();

    tally(result.total, receipt);
    tally(result.by_source[source], receipt);
    tally(result.by_parser[parser], receipt);
  }

  return result;
}

function table(title, counts) {
  const header = `${title}\n  campo       certo  errado  vazio  errado sem destaque`;
  const rows = Object.entries(FIELDS).map(([field, label]) => {
    const { right, wrong, empty, wrong_unflagged } = counts[field];
    return `  ${label.padEnd(10)}${String(right).padStart(6)}${String(wrong).padStart(8)}${String(empty).padStart(7)}${String(wrong_unflagged).padStart(21)}`;
  });

  return [header, ...rows].join('\n');
}

function render(result) {
  const header =
    result.mode === 'reextract'
      ? [
          `Comprovantes confirmados: ${result.confirmed} (${result.without_proposal} sem proposta: arquivo fora do disco ou pagina que falhou)`,
          'Reextraido agora, com o codigo e o cadastro de emitentes de hoje: a categoria do cadastro ja aprendeu com esta conferencia.',
        ].join('\n')
      : `Comprovantes confirmados: ${result.confirmed} (${result.without_proposal} sem a proposta da extracao, confirmados antes de ela ser guardada)`;
  const blocks = [
    header,
    table('Total', result.total),
    ...Object.entries(result.by_source).map(([source, counts]) =>
      table(`Origem: ${source}`, counts),
    ),
    ...Object.entries(result.by_parser).map(([parser, counts]) =>
      table(`Parser: ${parser}`, counts),
    ),
  ];

  return `\n${blocks.join('\n\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (Number.isNaN(args.report)) {
    process.stderr.write(`\n--report deve ser um id numerico.\n${USAGE}\n`);
    process.exitCode = 1;
    return;
  }

  let receipts = await Receipt.findConfirmedForEvaluation(args.report);

  if (args.reextract) {
    process.stderr.write(
      `Reextraindo ${receipts.length} paginas; o OCR leva alguns segundos por pagina escaneada.\n`,
    );
    receipts = await reextract(receipts);
  }

  const result = evaluate(receipts, args.reextract ? 'reextract' : 'stored');

  process.stdout.write(
    args.json ? `${JSON.stringify(result)}\n` : render(result),
  );
}

main()
  .catch((error) => {
    process.stderr.write(`\nFalha ao avaliar: ${error.message}\n`);
    process.exitCode = 1;
  })
  // O worker do OCR, se a reextracao o subiu, segura o processo aberto.
  .finally(() => Promise.all([db.close(), ocrService.shutdown()]));
