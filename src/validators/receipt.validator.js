'use strict';

const {
  BadRequestError,
  ConflictError,
  ValidationError,
} = require('../../infra/errors');
const { isValidIsoDate, parseId, validateCnpj } = require('./rules');
const accessKey = require('../services/extraction/access-key');

const BODY_NOT_OBJECT = {
  message: 'Corpo da requisicao deve ser um objeto JSON.',
  action: 'Envie um objeto com os campos do comprovante.',
};

const INVALID_ID = {
  message: 'id deve ser um inteiro positivo.',
  action: 'Use o id numerico devolvido pela listagem de comprovantes.',
};

const EXPENSE_CATEGORIES = [
  'alimentacao',
  'combustivel',
  'lavanderia',
  'transporte',
  'outros',
  'nao_classificado',
];

const RECEIPT_STATUSES = [
  'pending',
  'processing',
  'needs_review',
  'confirmed',
  'duplicate',
  'failed',
];

// Campos que a revisao humana preenche, e sem os quais nao se confirma.
const REVIEWED_FIELDS = ['issued_at', 'amount_cents', 'category'];

// Corrigir qualquer um destes marca a origem como manual — e o que permite a
// tela destacar o que veio de OCR. Chave, CNPJ e emitente entram aqui e nao na
// lista de cima: recibo manuscrito e comanda nao tem chave, e se confirmam do
// mesmo jeito.
const MANUAL_FIELDS = [
  ...REVIEWED_FIELDS,
  'access_key',
  'cnpj',
  'issuer_name',
  'issuer_city',
];

const ISSUER_MAX_LENGTH = 255;

function fromEnum(field, allowed) {
  return (value, errors) => {
    if (typeof value !== 'string' || !allowed.includes(value)) {
      errors.push({
        field,
        message: `${field} deve ser um de: ${allowed.join(', ')}`,
      });
      return undefined;
    }
    return value;
  };
}

const validateCategory = fromEnum('category', EXPENSE_CATEGORIES);
const validateStatus = fromEnum('status', RECEIPT_STATUSES);

function validateIssuedAt(value, errors) {
  if (value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string' || !isValidIsoDate(value)) {
    errors.push({
      field: 'issued_at',
      message: 'issued_at deve ser uma data valida no formato YYYY-MM-DD',
    });
    return undefined;
  }

  return value;
}

function validateAmountCents(value, errors) {
  if (value === null) {
    return null;
  }

  if (!Number.isInteger(value) || value < 0) {
    errors.push({
      field: 'amount_cents',
      message:
        'amount_cents deve ser um inteiro de centavos maior ou igual a 0',
    });
    return undefined;
  }

  return value;
}

/**
 * Chave de acesso digitada na revisao, quando o QR e o texto nao a deram.
 *
 * Aceita os separadores com que a chave e impressa e devolve so os 44
 * caracteres. O DV decide: o procedimento conta o cupom em que o mes da
 * emissao saia borrado e parecia 2606 — so 2608 fechava o verificador, e era
 * a data certa. Chave que nao fecha e recusada, nunca gravada pela metade.
 */
function validateAccessKey(value, errors) {
  if (value === null) {
    return null;
  }

  const key = accessKey.normalizeKey(value);

  if (key === null) {
    errors.push({
      field: 'access_key',
      message:
        'access_key deve ter 44 caracteres: 6 digitos, 12 letras ou digitos e 26 digitos',
    });
    return undefined;
  }

  if (!accessKey.isValid(key)) {
    errors.push({
      field: 'access_key',
      message: 'access_key nao fecha o digito verificador',
    });
    return undefined;
  }

  return key;
}

/**
 * Nome ou cidade de quem emitiu, como estao no papel (issue 42). Texto livre:
 * a cidade e a do documento, nunca a do destino da viagem, e nenhuma lista de
 * municipios acertaria o que o recibo manuscrito traz. Vazio vira nulo.
 */
function issuerText(field) {
  return (value, errors) => {
    if (value === null) {
      return null;
    }

    if (typeof value !== 'string') {
      errors.push({ field, message: `${field} deve ser uma string ou null` });
      return undefined;
    }

    const text = value.trim();

    if (text.length > ISSUER_MAX_LENGTH) {
      errors.push({
        field,
        message: `${field} deve ter no maximo ${ISSUER_MAX_LENGTH} caracteres`,
      });
      return undefined;
    }

    return text === '' ? null : text;
  };
}

const validateIssuerName = issuerText('issuer_name');
const validateIssuerCity = issuerText('issuer_city');

// Quarto de volta, no sentido horario, como o `/Rotate` do PDF.
const ROTATIONS = [0, 90, 180, 270];

/**
 * Giro da pagina escolhido na revisao (issue 43). Nao marca a origem como
 * manual: girar nao muda nenhum valor lido, e e justamente o passo antes de
 * reprocessar — com a marca, o reprocessamento pediria para descartar uma
 * conferencia que ninguem fez.
 */
function validateRotation(value, errors) {
  if (!ROTATIONS.includes(value)) {
    errors.push({
      field: 'rotation',
      message: 'rotation deve ser 0, 90, 180 ou 270',
    });
    return undefined;
  }

  return value;
}

function assertValid(errors) {
  if (errors.length > 0) {
    throw new ValidationError({ details: errors });
  }
}

/**
 * Confirmar significa afirmar que a linha esta pronta para a prestacao de
 * contas. Sem data, valor ou categoria ela nao esta — e deixar passar aqui e
 * o que produz planilha com lacuna descoberta so na conferencia.
 */
function assertConfirmable(merged, errors) {
  for (const field of REVIEWED_FIELDS) {
    if (merged[field] === null || merged[field] === undefined) {
      errors.push({
        field,
        message: `${field} e obrigatorio para confirmar o comprovante`,
      });
    }
  }
}

function validateUpdate(body, current = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError(BODY_NOT_OBJECT);
  }

  const errors = [];
  const data = {};

  if (body.issued_at !== undefined) {
    data.issued_at = validateIssuedAt(body.issued_at, errors);
  }

  if (body.amount_cents !== undefined) {
    data.amount_cents = validateAmountCents(body.amount_cents, errors);
  }

  if (body.category !== undefined) {
    data.category = validateCategory(body.category, errors);
  }

  if (body.status !== undefined) {
    data.status = validateStatus(body.status, errors);
  }

  if (body.access_key !== undefined) {
    data.access_key = validateAccessKey(body.access_key, errors);
  }

  if (body.issuer_name !== undefined) {
    data.issuer_name = validateIssuerName(body.issuer_name, errors);
  }

  if (body.issuer_city !== undefined) {
    data.issuer_city = validateIssuerCity(body.issuer_city, errors);
  }

  if (body.rotation !== undefined) {
    data.rotation = validateRotation(body.rotation, errors);
  }

  // Nulo desvincula o emitente — o CNPJ do texto pode ser o da credenciadora
  // do cartao, e nao o de quem vendeu.
  if (body.cnpj !== undefined) {
    data.cnpj = body.cnpj === null ? null : validateCnpj(body.cnpj, errors);
  }

  assertValid(errors);

  if (Object.keys(data).length === 0) {
    throw new ValidationError({
      message: 'Informe ao menos um campo para atualizar.',
      details: [
        {
          field: 'body',
          message:
            'campos aceitos: issued_at, amount_cents, category, status, access_key, cnpj, issuer_name, issuer_city, rotation',
        },
      ],
    });
  }

  // O CNPJ confiavel e o das posicoes 7 a 20 da chave. Com ela no comprovante,
  // um CNPJ digitado so poderia contradize-la.
  if ('cnpj' in data && (current.access_key || data.access_key)) {
    throw new ValidationError({
      details: [
        {
          field: 'cnpj',
          message: 'cnpj vem da chave de acesso deste comprovante',
        },
      ],
    });
  }

  const merged = { ...current, ...data };

  if (merged.status === 'confirmed') {
    assertConfirmable(merged, errors);
    assertValid(errors);
  }

  // Correcao humana marca a origem, para a revisao saber o que ja foi olhado.
  if (MANUAL_FIELDS.some((field) => field in data)) {
    data.extraction_source = 'manual';
  }

  // Uma pessoa mexeu na categoria, ou assinou embaixo dela ao confirmar: nos
  // dois casos deixou de ser palpite, e o destaque da revisao tem de sumir.
  if ('category' in data || merged.status === 'confirmed') {
    data.category_guessed = false;
  }

  return data;
}

/**
 * Reprocessar regrava data, valor e categoria com o que a extracao ler. Sobre
 * o que uma pessoa ja conferiu — confirmou, ou corrigiu a mao — isso apaga
 * trabalho de revisao. A API aceitava sem perguntar; agora pede a confirmacao
 * explicita em `discard_review`, decidida com quem usa.
 */
function validateReprocess(body, current) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError({
      message: 'Corpo da requisicao deve ser um objeto JSON.',
      action: 'Envie um objeto vazio, ou { "discard_review": true }.',
    });
  }

  if (
    body.discard_review !== undefined &&
    typeof body.discard_review !== 'boolean'
  ) {
    throw new ValidationError({
      details: [
        {
          field: 'discard_review',
          message: 'discard_review deve ser booleano',
        },
      ],
    });
  }

  const reviewed =
    current.status === 'confirmed' || current.extraction_source === 'manual';

  if (reviewed && body.discard_review !== true) {
    throw new ConflictError({
      message: 'Este comprovante ja foi conferido por uma pessoa.',
      action:
        'Reprocessar substitui a data, o valor e a categoria conferidos pelo que a extracao ler. Para seguir mesmo assim, confirme o descarte da conferencia.',
    });
  }
}

function validateId(rawId) {
  return parseId(rawId, INVALID_ID);
}

function validateListQuery(query = {}) {
  const errors = [];
  const result = {};

  if (query.status !== undefined) {
    result.status = validateStatus(query.status, errors);
  }

  if (query.category !== undefined) {
    result.category = validateCategory(query.category, errors);
  }

  assertValid(errors);
  return result;
}

module.exports = {
  EXPENSE_CATEGORIES,
  RECEIPT_STATUSES,
  validateUpdate,
  validateReprocess,
  validateId,
  validateListQuery,
};
