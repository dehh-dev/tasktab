'use strict';

const sessions = require('../services/auth/session.service');

/**
 * Resolve a sessao do cookie e a deixa em `req.user` / `req.session`.
 *
 * **Nao barra ninguem.** Roda em toda a `/api` porque `/api/health` e o login
 * precisam responder sem sessao; quem exige credencial e o `authorize.js`.
 * Separar os dois evita a lista de excecoes dentro do middleware que autentica
 * — que e onde uma rota nova entra desprotegida sem ninguem notar.
 */
async function authenticate(req, res, next) {
  try {
    const token = sessions.readToken(req);
    const resolved = await sessions.resolve(token);

    if (resolved) {
      req.user = resolved.user;
      req.session = resolved.session;
      // O id de quem fez a requisicao passa a acompanhar cada linha de log.
      // E-mail e token ficam de fora de proposito: o id basta para investigar
      // e nao transforma o log num cadastro de pessoas.
      req.log = req.log.child({ user_id: resolved.user.id });
    } else {
      req.user = null;
      req.session = null;
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = authenticate;
