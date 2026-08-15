'use strict';

const env = require('../src/config/env');
const {
  BaseError,
  InternalServerError,
  BadRequestError,
  NotFoundError,
} = require('./errors');

/** Ultima parada: nenhuma rota respondeu a requisicao. */
function onNoMatchHandler(req, res) {
  const publicError = new NotFoundError({
    message: `Rota nao encontrada: ${req.method} ${req.originalUrl}`,
    action: 'Confira o metodo e o caminho da requisicao.',
  });

  res.status(publicError.statusCode).json(publicError.toJSON());
}

/**
 * Converte qualquer erro que chegue ate aqui numa resposta publica.
 *
 * A assinatura de 4 argumentos e o que marca este middleware como handler de
 * erro para o Express — nao remova o `next`.
 */
// eslint-disable-next-line no-unused-vars
function onErrorHandler(error, req, res, next) {
  // Erro esperado: ja nasceu com statusCode, action e serializacao propria.
  if (error instanceof BaseError && error.statusCode < 500) {
    return res.status(error.statusCode).json(error.toJSON());
  }

  // JSON malformado vindo do express.json(). Vira um erro esperado nosso,
  // preservando a causa original.
  if (error.type === 'entity.parse.failed') {
    const publicError = new BadRequestError({
      message: 'JSON invalido.',
      action: 'Verifique a sintaxe do corpo enviado.',
      cause: error,
    });

    return res.status(publicError.statusCode).json(publicError.toJSON());
  }

  // Inesperado: loga o rastro completo e devolve uma mensagem generica.
  const publicError = new InternalServerError({ cause: error });

  if (!env.isTest) {
    console.error(publicError);
  }

  return res.status(publicError.statusCode).json(publicError.toJSON());
}

module.exports = {
  errorHandlers: {
    onNoMatch: onNoMatchHandler,
    onError: onErrorHandler,
  },
};
