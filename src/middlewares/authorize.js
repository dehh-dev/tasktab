'use strict';

const { UnauthorizedError, ForbiddenError } = require('../../infra/errors');
const { SCOPES, hasScope } = require('../services/auth/scopes');

/**
 * Exige sessao. Sem escopo nenhum: serve para o que basta estar autenticado
 * para fazer, como sair e consultar o proprio cadastro.
 */
function requireAuth(req, res, next) {
  if (!req.user) {
    return next(new UnauthorizedError());
  }

  return next();
}

/**
 * Exige um escopo, declarado no mapeamento da rota.
 *
 * Fica na rota e nao no controller de proposito: e o unico lugar onde da para
 * ler, de cima a baixo, o que cada endpoint exige. Um controller novo que
 * esqueca a checagem passaria despercebido; uma rota sem `requireScope` salta
 * aos olhos ao lado das vizinhas.
 *
 * O nome do escopo e conferido contra a lista na carga do modulo: um erro de
 * digitacao (`report:read`) derruba o processo no boot em vez de liberar a
 * rota em silencio, que e o pior desfecho possivel para uma checagem de
 * permissao.
 */
function requireScope(scope) {
  if (!SCOPES.includes(scope)) {
    throw new Error(`escopo desconhecido: ${scope}`);
  }

  return function checkScope(req, res, next) {
    if (!req.user) {
      return next(new UnauthorizedError());
    }

    if (!hasScope(req.user, scope)) {
      return next(
        new ForbiddenError({
          message: `Sua conta nao tem permissao para: ${scope}.`,
          action: 'Peca a um administrador o acesso necessario.',
        }),
      );
    }

    return next();
  };
}

module.exports = { requireAuth, requireScope };
