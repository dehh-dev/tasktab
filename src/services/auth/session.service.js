'use strict';

const crypto = require('crypto');
const Session = require('../../models/session.model');
const env = require('../../config/env');
const { scopesForRole } = require('./scopes');

const TOKEN_BYTES = 32;
const HOUR_MS = 60 * 60 * 1000;
const TTL_SECONDS = env.session.ttlHours * 60 * 60;

/**
 * O token e 256 bits de aleatoriedade criptografica — nao carrega significado
 * nenhum e nao ha o que adivinhar nele. O que vai para o banco e o SHA-256
 * dele: um dump vazado nao vira acesso.
 *
 * SHA-256 basta aqui, e nao seria suficiente para senha. A diferenca e a
 * entropia da entrada: nao ha dicionario de tokens de 32 bytes aleatorios para
 * uma GPU percorrer, enquanto ha para senhas escolhidas por gente.
 */
function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function start(userId) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + env.session.ttlHours * HOUR_MS);

  const session = await Session.create({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
  });

  return { token, session };
}

/** Resolve o token cru na dupla sessao + usuario, ja com os escopos do papel. */
async function resolve(token) {
  if (!token) {
    return null;
  }

  const row = await Session.findActiveByTokenHash(
    hashToken(token),
    TTL_SECONDS,
  );

  if (!row) {
    return null;
  }

  return {
    session: { id: row.id, expires_at: row.expires_at },
    renewDue: row.renew_due,
    user: {
      id: row.user_id,
      name: row.name,
      email: row.email,
      role: row.role,
      // Derivado do papel a cada requisicao, e nao gravado na sessao: mudar o
      // papel de alguem passa a valer na requisicao seguinte, sem depender de
      // a pessoa sair e entrar de novo.
      scopes: scopesForRole(row.role),
    },
  };
}

/**
 * Estende a sessao de quem esta usando o sistema.
 *
 * Sem isto a sessao vencia uma semana depois do login mesmo para quem entra
 * todo dia — no meio da revisao de um lote, sem aviso. So renova depois da
 * metade da validade: renovar a cada requisicao seria uma escrita no banco
 * por clique, para ganhar minutos.
 */
async function renew(res, token, session) {
  await Session.renew(session.id, TTL_SECONDS);
  setCookie(res, token);
}

function end(token) {
  return token ? Session.removeByTokenHash(hashToken(token)) : false;
}

/**
 * Le o cookie da sessao do header cru.
 *
 * Sao dez linhas no lugar de uma dependencia (`cookie-parser`), e o projeto
 * segue a regra de nao acrescentar pacote para o que cabe aqui. Nao ha
 * assinatura a conferir: o valor ja e um segredo de 256 bits guardado como
 * hash, entao assinar so acrescentaria uma chave para vazar.
 */
function readToken(req) {
  const header = req.headers.cookie;

  if (!header) {
    return null;
  }

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');

    if (separator === -1) {
      continue;
    }

    if (part.slice(0, separator).trim() === env.session.cookieName) {
      return decodeToken(part.slice(separator + 1).trim());
    }
  }

  return null;
}

/**
 * Valor com `%` quebrado nao e sessao nenhuma. Deixar o `URIError` do
 * `decodeURIComponent` estourar transformava um cookie adulterado num 500 em
 * toda a API — inclusive no login, que e justamente onde a pessoa sairia da
 * situacao entrando de novo.
 */
function decodeToken(raw) {
  try {
    return decodeURIComponent(raw) || null;
  } catch {
    return null;
  }
}

/**
 * `httpOnly` mantem o token fora do alcance de qualquer JavaScript da pagina,
 * que e o que limita o estrago de um XSS.
 *
 * `sameSite: 'lax'` e o que dispensa token de CSRF nesta API: sob Lax o cookie
 * so acompanha navegacao de topo por GET, e toda escrita daqui e POST, PATCH
 * ou DELETE. Um formulario hostil em outro site nao leva a sessao junto.
 * **Trocar isto por `none` reintroduz o CSRF** e passaria a exigir token.
 */
function setCookie(res, token) {
  res.cookie(env.session.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.session.cookieSecure,
    path: '/',
    maxAge: env.session.ttlHours * HOUR_MS,
  });
}

function clearCookie(res) {
  res.clearCookie(env.session.cookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.session.cookieSecure,
    path: '/',
  });
}

module.exports = {
  start,
  resolve,
  renew,
  end,
  readToken,
  setCookie,
  clearCookie,
  hashToken,
  generateToken,
};
