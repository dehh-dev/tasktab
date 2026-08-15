'use strict';

const {
  BaseError,
  InternalServerError,
  BadRequestError,
  NotFoundError,
} = require('./errors');

/** Ultima parada: nenhuma rota respondeu a requisicao. */
function onNoMatchHandler(req, res) {
  return respond(
    res,
    req,
    new NotFoundError({
      message: `Rota nao encontrada: ${req.method} ${req.originalUrl}`,
      action: 'Confira o metodo e o caminho da requisicao.',
    }),
  );
}

/**
 * Converte qualquer erro que chegue ate aqui numa resposta publica.
 *
 * A assinatura de 4 argumentos e o que marca este middleware como handler de
 * erro para o Express — nao remova o `next`.
 */
/**
 * Responde no formato publico do erro. Nos 5xx acrescenta o `request_id`: e o
 * que liga a reclamacao do usuario a linha de log, ja que a mensagem devolvida
 * e deliberadamente generica. Nos 4xx o proprio corpo ja diz o que corrigir, e
 * acrescentar o id so mudaria o contrato sem ganho.
 */
function respond(res, req, publicError) {
  const body = publicError.toJSON();

  if (publicError.statusCode >= 500 && req.id) {
    body.request_id = req.id;
  }

  return res.status(publicError.statusCode).json(body);
}

// eslint-disable-next-line no-unused-vars
function onErrorHandler(error, req, res, next) {
  // Erro esperado: ja nasceu com statusCode, action e serializacao propria.
  // Inclui os 5xx deliberados (ServiceError), cuja mensagem publica ja foi
  // escrita para nao vazar detalhe interno — por isso so eles sao logados.
  if (error instanceof BaseError) {
    if (error.statusCode >= 500) {
      req.log.error({ err: error }, error.message);
    }

    return respond(res, req, error);
  }

  // JSON malformado vindo do express.json(). Vira um erro esperado nosso,
  // preservando a causa original.
  if (error.type === 'entity.parse.failed') {
    return respond(
      res,
      req,
      new BadRequestError({
        message: 'JSON invalido.',
        action: 'Verifique a sintaxe do corpo enviado.',
        cause: error,
      }),
    );
  }

  // Inesperado: loga o rastro completo e devolve uma mensagem generica.
  const publicError = new InternalServerError({ cause: error });

  req.log.error({ err: error }, 'erro nao tratado');

  return respond(res, req, publicError);
}

module.exports = {
  errorHandlers: {
    onNoMatch: onNoMatchHandler,
    onError: onErrorHandler,
  },
};
