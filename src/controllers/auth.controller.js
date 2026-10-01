'use strict';

const User = require('../models/user.model');
const Session = require('../models/session.model');
const validator = require('../validators/user.validator');
const password = require('../services/auth/password');
const sessions = require('../services/auth/session.service');
const { scopesForRole } = require('../services/auth/scopes');
const { UnauthorizedError } = require('../../infra/errors');

/**
 * Uma resposta so para credencial errada, seja o e-mail inexistente ou a senha
 * incorreta. Distinguir as duas transformaria o login num verificador de quem
 * tem conta aqui.
 */
function invalidCredentials() {
  return new UnauthorizedError({
    message: 'E-mail ou senha invalidos.',
    action: 'Confira os dados e tente de novo.',
  });
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    scopes: user.scopes || scopesForRole(user.role),
  };
}

/** POST /api/auth/login */
async function login(req, res) {
  const { email, password: senha } = validator.validateLogin(req.body);
  const user = await User.findByEmailWithSecret(email);

  if (!user) {
    // Gasta o mesmo tempo de uma verificacao real. Sem isto, a resposta
    // instantanea para e-mail inexistente entregaria quais estao cadastrados.
    await password.dummyVerify(senha);
    throw invalidCredentials();
  }

  if (!(await password.verify(senha, user.password_hash))) {
    req.log.warn({ user_id: user.id }, 'tentativa de login com senha invalida');
    throw invalidCredentials();
  }

  if (password.needsRehash(user.password_hash)) {
    await User.updatePassword(user.id, await password.hash(senha));
    req.log.info(
      { user_id: user.id },
      'hash da senha refeito com o custo atual',
    );
  }

  // O login e raro e ja e a requisicao mais lenta do sistema (a KDF); e o
  // lugar barato para varrer as sessoes vencidas, sem um processo em segundo
  // plano so para isso.
  await Session.removeExpired();

  const { token } = await sessions.start(user.id);

  sessions.setCookie(res, token);
  req.log.info({ user_id: user.id }, 'login');

  res.json({ data: publicUser(user) });
}

/**
 * POST /api/auth/logout
 *
 * Apaga a linha da sessao — o token morre aqui, e nao quando venceria. E o que
 * um JWT nao entrega sem uma lista de bloqueio consultada a cada requisicao.
 */
async function logout(req, res) {
  await sessions.end(sessions.readToken(req));
  sessions.clearCookie(res);

  res.status(204).send();
}

/**
 * GET /api/auth/me
 *
 * A interface chama isto ao abrir para saber se ha sessao e o que mostrar: os
 * escopos vao na resposta para que a tela nao ofereca um botao que a API vai
 * recusar. E conveniencia de interface, nao autorizacao — quem decide continua
 * sendo o servidor, a cada requisicao.
 */
async function me(req, res) {
  res.json({ data: publicUser(req.user) });
}

module.exports = { login, logout, me };
