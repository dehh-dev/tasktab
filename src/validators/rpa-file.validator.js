'use strict';

const { BadRequestError, ValidationError } = require('../../infra/errors');
const { parseId } = require('./rules');
const { UPDATABLE_COLUMNS } = require('../models/rpa-file.model');

/**
 * Os documentos do formulario (issue 41). O PATCH e a escolha na mao: a
 * pessoa do documento que nao casou, ou o tipo e o lado que o .zip trouxe
 * errados. O recibo assinado e da issue 42 e nao entra aqui.
 */
const KINDS = ['ctps', 'id_document', 'address_proof', 'bank_details'];
const SIDES = ['front', 'back'];

const INVALID_ID = {
  message: 'id deve ser um inteiro positivo.',
  action: 'Use o id numerico devolvido pela lista de documentos.',
};

function validateUpdate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError({
      message: 'Corpo da requisicao deve ser um objeto JSON.',
      action: 'Envie a pessoa, o tipo ou o lado do documento.',
    });
  }

  const errors = [];
  const data = {};

  if (body.worker_id !== undefined) {
    if (
      body.worker_id !== null &&
      (!Number.isInteger(body.worker_id) || body.worker_id < 1)
    ) {
      errors.push({
        field: 'worker_id',
        message: 'worker_id deve ser o id de uma pessoa do lancamento ou null',
      });
    } else {
      data.worker_id = body.worker_id;
    }
  }

  if (body.kind !== undefined) {
    if (!KINDS.includes(body.kind)) {
      errors.push({
        field: 'kind',
        message: `kind deve ser ${KINDS.join(', ')}`,
      });
    } else {
      data.kind = body.kind;
    }
  }

  if (body.side !== undefined) {
    if (body.side !== null && !SIDES.includes(body.side)) {
      errors.push({
        field: 'side',
        message: 'side deve ser front, back ou null',
      });
    } else {
      data.side = body.side;
    }
  }

  if (errors.length > 0) throw new ValidationError({ details: errors });

  if (Object.keys(data).length === 0) {
    throw new ValidationError({
      message: 'Informe ao menos um campo para atualizar.',
      details: [
        {
          field: 'body',
          message: `campos aceitos: ${UPDATABLE_COLUMNS.join(', ')}`,
        },
      ],
    });
  }

  return data;
}

/** `?email=true` reduz as fotos para caber no e-mail. */
function validateZipQuery(query = {}) {
  if (query.email === undefined || query.email === 'false')
    return { email: false };
  if (query.email === 'true') return { email: true };

  throw new ValidationError({
    details: [{ field: 'email', message: 'email deve ser true ou false' }],
  });
}

function validateId(rawId) {
  return parseId(rawId, INVALID_ID);
}

module.exports = { validateUpdate, validateZipQuery, validateId };
