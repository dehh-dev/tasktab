'use strict';

const ApiError = require('../errors/api-error');
const env = require('../config/env');

function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      message: `Rota nao encontrada: ${req.method} ${req.originalUrl}`,
    },
  });
}

// A assinatura de 4 argumentos e o que marca este middleware como handler de
// erro para o Express — nao remover o `next`.
// eslint-disable-next-line no-unused-vars
function errorHandler(error, req, res, next) {
  if (error instanceof ApiError) {
    return res.status(error.statusCode).json({
      error: {
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
  }

  // JSON malformado vindo do express.json()
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'JSON invalido' } });
  }

  if (!env.isTest) {
    console.error(error);
  }

  return res
    .status(500)
    .json({ error: { message: 'Erro interno do servidor' } });
}

module.exports = { notFoundHandler, errorHandler };
