'use strict';

/**
 * Como o RPA, o nome do arquivo e o e-mail de solicitacao escrevem os dados
 * (issue 40). Tudo puro: o PDF e o e-mail so montam o que sai daqui.
 *
 * O PDF e o e-mail levam acento (sao para gente); o nome do arquivo tambem,
 * com uma alternativa ASCII no `Content-Disposition` para cliente antigo.
 */

// O RPA e emitido em horario de Brasilia, sem horario de verao desde 2019.
const BRASILIA_OFFSET_MS = -3 * 60 * 60 * 1000;

const ACCOUNT_TYPES = {
  checking: 'CORRENTE',
  savings: 'POUPANÇA',
  payment: 'PAGAMENTO',
};

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function formatCpf(cpf) {
  const value = digits(cpf);
  return value.length === 11
    ? value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
    : String(cpf ?? '');
}

function formatPis(pis) {
  const value = digits(pis);
  return value.length === 11
    ? value.replace(/(\d{3})(\d{5})(\d{2})(\d)/, '$1.$2.$3-$4')
    : String(pis ?? '');
}

function formatCep(cep) {
  const value = digits(cep);
  return value.length === 8
    ? value.replace(/(\d{5})(\d{3})/, '$1-$2')
    : String(cep ?? '');
}

/** `2026-10-20` -> `20/10/2026`, sem `Date`. */
function formatDate(date) {
  if (!date) return '';
  const [year, month, day] = String(date).slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

/** Centavos -> `R$ 1.234,56`. */
function formatMoney(cents) {
  const sign = cents < 0 ? '-' : '';
  const value = Math.abs(cents);
  const reais = String(Math.floor(value / 100)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    '.',
  );
  return `${sign}R$ ${reais},${String(value % 100).padStart(2, '0')}`;
}

/** Pontos-base -> `11%`, `7,5%`. */
function formatRate(basisPoints) {
  const percent = basisPoints / 100;
  return `${String(percent).replace('.', ',')}%`;
}

function accountTypeLabel(type) {
  return ACCOUNT_TYPES[type] ?? '';
}

/** O instante em Brasilia, como `{ date: 'dd-mm-aaaa', time: 'hhmmss' }`. */
function brasiliaStamp(instant) {
  const local = new Date(new Date(instant).getTime() + BRASILIA_OFFSET_MS);
  const pad = (value) => String(value).padStart(2, '0');

  return {
    date: `${pad(local.getUTCDate())}-${pad(local.getUTCMonth() + 1)}-${local.getUTCFullYear()}`,
    time: `${pad(local.getUTCHours())}${pad(local.getUTCMinutes())}${pad(local.getUTCSeconds())}`,
  };
}

/** Primeira e ultima palavra do nome, sem o que o sistema de arquivos recusa. */
function shortName(name) {
  const words = String(name ?? '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= 1) return words.join('');
  return `${words[0]} ${words.at(-1)}`;
}

/**
 * `Solicitação - RPA - 1ª Pagto -Nome Sobrenome_dd-mm-aaaa_hhmmss.pdf`, o nome
 * que a planilha dava (o espaco antes do nome e assim mesmo). A hora e a da
 * emissao gravada: baixar de novo da o mesmo arquivo.
 */
function rpaFileName({ number, workerName, issuedAt }) {
  const stamp = brasiliaStamp(issuedAt);
  return `Solicitação - RPA - ${number}ª Pagto -${shortName(workerName)}_${stamp.date}_${stamp.time}.pdf`;
}

/** O mesmo nome so com ASCII: `ç` -> `c`, `ª` -> `a`. */
function asciiFileName(name) {
  return name
    .replace(/ª/g, 'a')
    .replace(/º/g, 'o')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
}

/**
 * `attachment` com `filename` ASCII e `filename*` em UTF-8 (RFC 6266 e 5987):
 * o primeiro download do projeto com acento no nome.
 */
function contentDisposition(name) {
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiFileName(name)}"; filename*=UTF-8''${encoded}`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * O e-mail de solicitacao ao financeiro. O tasktab nao envia nada: devolve o
 * assunto, os destinatarios e o corpo para quem pede colar no Gmail. Do 2o
 * pagamento em diante o texto e o da resposta na mesma conversa — o assunto
 * nao muda, para o Gmail juntar as mensagens.
 */
function requestEmail({ launch, number, paymentDates, count }) {
  const place = `${launch.city}/${launch.state}`;
  const subject = `SOLICITAÇÃO DE EMISSÃO RPA - LANÇAMENTO ${place.toUpperCase()} - EMP. ${launch.company_code}`;
  const opening =
    number === 1
      ? `Solicito emissão de RPA da equipe administrativa de lançamento em ${place}.`
      : `Solicito emissão de RPA do ${number}º pagamento da equipe administrativa de lançamento em ${place}.`;
  const fields = [
    ['Empresa', `${launch.company_code} - ${launch.company_name}`],
    ['Obra', launch.site],
    ['Produto', launch.product],
    ['Insumo', launch.supply],
    ['Data para pagamento', paymentDates.map(formatDate).join(', ')],
  ].filter(([, value]) => value);
  const attachments =
    count === 1 ? 'Segue em anexo 1 RPA.' : `Seguem em anexo ${count} RPAs.`;

  const text = [
    opening,
    '',
    ...fields.map(([label, value]) => `${label}: ${value}`),
    '',
    attachments,
  ].join('\n');

  // Os campos em negrito vermelho, como no e-mail que o financeiro ja recebe.
  const html = [
    `<p>${escapeHtml(opening)}</p>`,
    '<p>',
    fields
      .map(
        ([label, value]) =>
          `${escapeHtml(label)}: <strong style="color:#c00000">${escapeHtml(value)}</strong>`,
      )
      .join('<br>\n'),
    '</p>',
    `<p>${escapeHtml(attachments)}</p>`,
  ].join('\n');

  return {
    subject,
    to: launch.email_to,
    cc: launch.email_cc,
    reply: number > 1,
    text,
    html,
  };
}

module.exports = {
  formatCpf,
  formatPis,
  formatCep,
  formatDate,
  formatMoney,
  formatRate,
  accountTypeLabel,
  brasiliaStamp,
  shortName,
  rpaFileName,
  asciiFileName,
  contentDisposition,
  escapeHtml,
  requestEmail,
};
