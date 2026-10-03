'use strict';

/**
 * Rotulos em portugues para os enums do banco, usados nas exportacoes. Ficam
 * num lugar so para as tres saidas (resumo, Anexo I, PDF) nao divergirem.
 */

// `nao_classificado` de proposito nao esta aqui: e ausencia de decisao, nao
// categoria, e a aplicacao grava NULL no comprovante. Ter um rotulo proprio
// para ele criava dois nomes para a mesma coisa — foi o que fez o subtotal
// "Nao classificado" da planilha nunca casar com as linhas "Sem categoria".
// Os rotulos sao os do procedimento de prestacao de contas. `transporte` fica
// com esse nome no banco e sai como Taxi/Locomocao, que e como quem confere o
// chama.
const CATEGORY_LABELS = {
  alimentacao: 'Alimentação',
  combustivel: 'Combustível',
  lavanderia: 'Lavanderia',
  transporte: 'Táxi/Locomoção',
  outros: 'Outros',
};

const NO_CATEGORY_LABEL = 'Sem categoria';

const STATUS_LABELS = {
  pending: 'Pendente',
  processing: 'Processando',
  needs_review: 'Aguardando revisao',
  confirmed: 'Confirmado',
  duplicate: 'Duplicata',
  failed: 'Falhou',
};

/**
 * Chave de agrupamento de uma categoria: `null` quando nao ha decisao
 * humana registrada. Agrupar pelo valor cru separaria em dois grupos o que
 * a aplicacao trata como um so.
 */
function categoryKey(category) {
  return category && category !== 'nao_classificado' ? category : null;
}

function categoryLabel(category) {
  const key = categoryKey(category);
  return key ? CATEGORY_LABELS[key] || key : NO_CATEGORY_LABEL;
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

module.exports = {
  CATEGORY_LABELS,
  STATUS_LABELS,
  NO_CATEGORY_LABEL,
  categoryKey,
  categoryLabel,
  statusLabel,
};
