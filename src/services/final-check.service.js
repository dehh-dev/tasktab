'use strict';

const path = require('path');
const env = require('../config/env');
const Receipt = require('../models/receipt.model');
const accessKey = require('./extraction/access-key');
const planilha = require('./export/planilha.service');
const pdfPorCategoria = require('./export/pdf-por-categoria.service');

/**
 * A checagem final do procedimento de prestacao de contas (issue 57), feita
 * antes de o relatorio fechar. **Informa, nao bloqueia**: como na
 * conferencia, quem assina decide fechar mesmo com algo em aberto.
 *
 * Confere as entregas como elas saem, e nao uma conta paralela: as somas vem
 * dos mesmos grupos que a planilha escreve, e as paginas, dos PDFs por
 * categoria montados de verdade.
 */

/** "1 pagina recebida", "3 paginas recebidas". */
function plural(count, singular, many) {
  return `${count} ${count === 1 ? singular : many}`;
}

/**
 * Soma das linhas = total = subtotais por tipo = subtotais por cidade. O
 * total vem do banco, e o resto, dos grupos da planilha: um grupo que perde
 * uma linha — como ja aconteceu com o `nao_classificado` — deixa de bater.
 */
async function checkSums(reportId, receipts) {
  const { total_cents: total } = await Receipt.summarizeByReport(reportId, {
    status: 'confirmed',
  });
  const { lines, byType, byCity } = planilha.conferenceTotals(receipts);
  const ok = [total, byType, byCity].every((value) => value === lines);

  return {
    check: 'somas',
    ok,
    message: ok
      ? 'Soma das linhas, total e subtotais por tipo e por cidade batem.'
      : 'As somas da planilha nao batem entre si: confira antes de fechar.',
    values_cents: {
      lines,
      total,
      by_type: byType,
      by_city: byCity,
    },
  };
}

/**
 * Toda pagina em exatamente um PDF de categoria, e as geradas iguais as
 * recebidas. Montar os PDFs de verdade e o que faz um arquivo de comprovante
 * que sumiu do disco aparecer aqui, e nao na hora de exportar.
 */
async function checkPages(receipts) {
  const received = receipts.length;
  let files;

  try {
    files = await pdfPorCategoria.buildCategoryPdfs(receipts);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }

    const missing = receipts
      .filter(
        (receipt) =>
          path.join(env.upload.dir, receipt.file_path) === error.path,
      )
      .map((receipt) => receipt.id);

    return {
      check: 'paginas',
      ok: false,
      message: `O arquivo ${missing.length === 1 ? 'do comprovante' : 'dos comprovantes'} ${missing.join(', ')} nao esta no disco: os PDFs por categoria nao saem.`,
      received,
      generated: 0,
    };
  }

  const generated = files.reduce((total, file) => total + file.pageCount, 0);
  const placed = files.flatMap((file) => file.receiptIds);
  const ok =
    generated === received &&
    placed.length === received &&
    new Set(placed).size === received;

  let message = `${plural(received, 'pagina recebida', 'paginas recebidas')}, e ${generated} nos PDFs por categoria.`;

  if (ok) {
    message =
      received === 0
        ? 'Nenhuma pagina recebida ainda.'
        : `${plural(received, 'pagina recebida', 'paginas recebidas')}, cada uma em exatamente um PDF de categoria.`;
  }

  return { check: 'paginas', ok, message, received, generated };
}

/** Toda chave de acesso fechando o digito verificador. */
function checkKeys(receipts) {
  const invalid = receipts.filter(
    (receipt) => receipt.access_key && !accessKey.isValid(receipt.access_key),
  ).length;

  return {
    check: 'chaves',
    ok: invalid === 0,
    message:
      invalid === 0
        ? 'Toda chave de acesso passa no digito verificador.'
        : `${plural(invalid, 'chave de acesso nao passa', 'chaves de acesso nao passam')} no digito verificador.`,
    invalid,
  };
}

/**
 * Todo valor confirmado por uma pessoa. A duplicata fica de fora: nao e
 * valor da prestacao, e ja foi decidida.
 */
function checkConfirmed(receipts) {
  const pending = receipts.filter(
    (receipt) =>
      receipt.status !== 'confirmed' && receipt.status !== 'duplicate',
  ).length;

  return {
    check: 'confirmados',
    ok: pending === 0,
    message:
      pending === 0
        ? 'Todo valor foi confirmado por uma pessoa.'
        : `${plural(pending, 'comprovante ainda nao foi confirmado', 'comprovantes ainda nao foram confirmados')} por uma pessoa.`,
    pending,
  };
}

async function checkReport(reportId) {
  const receipts = await Receipt.findForExport(reportId);

  return [
    await checkSums(reportId, receipts),
    await checkPages(receipts),
    checkKeys(receipts),
    checkConfirmed(receipts),
  ];
}

module.exports = { checkReport };
