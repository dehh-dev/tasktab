'use strict';

/**
 * Rotulos em portugues para os enums do banco, usados nas exportacoes. Ficam
 * num lugar so para as tres saidas (resumo, Anexo I, PDF) nao divergirem.
 */

const CATEGORY_LABELS = {
  alimentacao: 'Alimentação',
  combustivel: 'Combustível',
  estacionamento: 'Estacionamento',
  lavanderia: 'Lavanderia',
  transporte: 'Transporte',
  hospedagem: 'Hospedagem',
  outros: 'Outros',
  nao_classificado: 'Não classificado',
};

const STATUS_LABELS = {
  pending: 'Pendente',
  processing: 'Processando',
  needs_review: 'Aguardando revisao',
  confirmed: 'Confirmado',
  duplicate: 'Duplicata',
  failed: 'Falhou',
};

function categoryLabel(category) {
  return category ? CATEGORY_LABELS[category] || category : 'Sem categoria';
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

module.exports = { CATEGORY_LABELS, STATUS_LABELS, categoryLabel, statusLabel };
