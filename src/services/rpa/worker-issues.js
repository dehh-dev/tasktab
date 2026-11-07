'use strict';

const { checkWorker } = require('./form-cleaning');

const sameIssue = (a, b) => a.code === b.code && a.field === b.field;

/**
 * As pendencias da pessoa depois de uma mudanca: um PATCH ou uma resposta
 * mais nova do formulario.
 *
 * - `changed`: os campos que mudaram de valor.
 * - As notas da limpeza (`source: 'form'`) dos campos que nao mudaram ficam;
 *   as dos que mudaram saem, trocadas pelas `notes` da resposta nova (vazio
 *   no PATCH: quem digitou o valor e a pessoa, nao a planilha).
 * - As verificacoes (`source: 'check'`) rodam de novo sobre o cadastro
 *   inteiro (`merged`) — mudar a data de nascimento pode resolver o "inicio
 *   igual ao nascimento", que e do campo `starts_on`.
 * - Quem deu uma pendencia por resolvida nao a ve voltar enquanto aquele
 *   campo nao mudar. `resolve` marca as que alguem acabou de conferir.
 */
function reconcileIssues({
  previous = [],
  merged,
  launch,
  changed,
  notes = [],
  resolve = [],
}) {
  const keptNotes = previous.filter(
    (entry) => entry.source === 'form' && !changed.has(entry.field),
  );
  const freshNotes = notes.filter((entry) => changed.has(entry.field));
  const allNotes = [...keptNotes, ...freshNotes];
  const skip = new Set(allNotes.map((entry) => entry.field));

  return [...allNotes, ...checkWorker(merged, launch, skip)].map((entry) => {
    const wasResolved =
      !changed.has(entry.field) &&
      previous.some((old) => old.resolved && sameIssue(old, entry));
    const nowResolved = resolve.some((item) => sameIssue(item, entry));

    return wasResolved || nowResolved ? { ...entry, resolved: true } : entry;
  });
}

/**
 * As pendencias que impedem o pagamento (issue 62, decisao de 2026-11-07):
 * banco, agencia, conta, CPF e PIS errados ou vazios. O financeiro paga pelo
 * que o RPA imprime, e o erro so apareceria na volta. As outras (endereco,
 * datas, cidade) so avisam. A nota de CPF ou PIS completado com zero nao
 * barra: o verificador fechou.
 */
const BLOCKING_CODES = new Set([
  'bank_ambiguous',
  'bank_unknown',
  'account_without_digit',
  'account_format',
  'cpf_invalid',
  'pis_invalid',
]);
const BLOCKING_MISSING = new Set([
  'bank_name',
  'agency',
  'account',
  'cpf',
  'pis',
]);

function blocksPayment(entry) {
  return (
    BLOCKING_CODES.has(entry.code) ||
    (entry.code === 'missing_field' && BLOCKING_MISSING.has(entry.field))
  );
}

/** As pendencias abertas da pessoa, como a previa e a emissao as mostram. */
function paymentIssues(issues = []) {
  return issues
    .filter((entry) => !entry.resolved)
    .map(({ code, field, message }) => ({
      code,
      field,
      message,
      blocks_payment: blocksPayment({ code, field }),
    }));
}

module.exports = { reconcileIssues, paymentIssues };
