'use strict';

/**
 * Express 4 nao captura rejeicoes de handlers async — este wrapper encaminha
 * qualquer erro para o middleware de tratamento de erros.
 */
function asyncHandler(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
