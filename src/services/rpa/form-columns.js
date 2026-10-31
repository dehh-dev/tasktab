'use strict';

const { fold } = require('./text');

/**
 * Qual pergunta do formulario vira qual campo da pessoa.
 *
 * Pelo titulo, nunca pela posicao: o formulario muda de um lancamento para o
 * outro (pergunta nova, ordem trocada), e a aba CADASTRO da planilha quebrava
 * em silencio quando isso acontecia. O titulo e comparado sem acento, sem
 * caixa e so ate a quebra de linha ou o "(Exemplo" — o de Avare e
 * "Cidade-UF\n(Exemplo: Goiania-GO)".
 *
 * Em ordem: a primeira regra que casa vence. "Nome completo MAE" tem de cair
 * em `mother_name` antes de chegar em `name`, e "Tipo de Conta" em
 * `account_type` antes de `account`.
 */
const RULES = [
  ['form_submitted_at', (t) => t.includes('carimbo')],
  ['email', (t) => /\be-?mail\b/.test(t) && !t.includes('pix')],
  ['pix_key_type', (t) => t.includes('pix') && t.includes('tipo')],
  ['pix_key', (t) => t.includes('pix')],
  ['cpf', (t) => /\bcpf\b/.test(t)],
  ['pis', (t) => /\b(pis|nit|pasep)\b/.test(t)],
  ['rg_issued_on', (t) => /\brg\b/.test(t) && t.includes('emissao')],
  ['rg', (t) => /\brg\b/.test(t)],
  ['birth_place', (t) => t.includes('nascimento') && t.includes('local')],
  ['birth_date', (t) => t.includes('nascimento')],
  ['mother_name', (t) => /\bmae\b/.test(t)],
  ['father_name', (t) => /\bpai\b/.test(t)],
  ['name', (t) => /\bnome\b/.test(t)],
  ['role', (t) => /\bfuncao\b/.test(t)],
  ['starts_on', (t) => /\binicio\b/.test(t)],
  ['address', (t) => t.includes('endereco')],
  ['district', (t) => /\b(bairro|setor)\b/.test(t)],
  ['city', (t) => /\bcidade\b/.test(t)],
  ['cep', (t) => /\bcep\b/.test(t)],
  ['agency', (t) => t.includes('agencia')],
  ['bank_operation', (t) => t.includes('operacao')],
  ['account_type', (t) => /\bconta\b/.test(t) && t.includes('tipo')],
  ['account', (t) => /\bconta\b/.test(t)],
  ['bank_name', (t) => /\bbanco\b/.test(t)],
  ['dependents', (t) => t.includes('dependente')],
];

/** O titulo como as regras o comparam: so a pergunta, sem o exemplo. */
function questionKey(title) {
  const question = String(title ?? '').split(/[\r\n]|\(/)[0];
  return fold(question);
}

/**
 * Os anexos (CTPS, RG, comprovante, dados bancarios) sao links do Drive:
 * documentos sao da issue 41, e aqui ficam de fora sem aviso.
 */
function isAttachment(title) {
  return fold(String(title ?? '')).startsWith('anexar');
}

/**
 * `{ fields: { indice: campo }, unknown: [titulo], repeated: [titulo] }`.
 * Pergunta que nao casa com nada vira aviso, nao erro: o formulario de outro
 * lancamento pode ter uma a mais.
 */
function mapHeader(titles) {
  const fields = {};
  const taken = new Set();
  const unknown = [];
  const repeated = [];

  titles.forEach((title, index) => {
    const key = questionKey(title);

    if (key === '' || isAttachment(title)) {
      return;
    }

    const rule = RULES.find(([, matches]) => matches(key));

    if (!rule) {
      unknown.push(String(title).trim());
      return;
    }

    const [field] = rule;

    if (taken.has(field)) {
      repeated.push(String(title).trim());
      return;
    }

    taken.add(field);
    fields[index] = field;
  });

  return { fields, unknown, repeated };
}

module.exports = { mapHeader, questionKey };
