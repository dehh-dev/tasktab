'use strict';

const db = require('../config/database');

/**
 * Sessoes gravadas no banco, e nao um JWT.
 *
 * O que se ganha e **revogacao**: "sair" apaga a linha e o token morre na
 * hora, e trocar a senha derruba as outras sessoes. Um JWT so expira — para
 * revoga-lo antes disso seria preciso uma lista de bloqueio, ou seja, uma
 * consulta ao banco por requisicao, que e exatamente o custo que o JWT prometia
 * evitar. Com o Postgres ja no caminho, a troca nao paga.
 */

/**
 * A leitura da sessao ja traz o usuario: sao os dois registros de que toda
 * requisicao autenticada precisa, e uma juncao custa menos que duas idas.
 * O filtro por `expires_at` e parte da consulta — sessao vencida simplesmente
 * nao existe, e nao ha como esquecer de conferir.
 */
async function findActiveByTokenHash(tokenHash) {
  const { rows } = await db.query(
    `SELECT s.id, s.user_id, s.expires_at,
            u.name, u.email, u.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [tokenHash],
  );
  return rows[0] || null;
}

async function create({ userId, tokenHash, expiresAt }) {
  const { rows } = await db.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING id, user_id, expires_at, created_at`,
    [userId, tokenHash, expiresAt],
  );
  return rows[0];
}

async function removeByTokenHash(tokenHash) {
  const { rows } = await db.query(
    'DELETE FROM sessions WHERE token_hash = $1 RETURNING id',
    [tokenHash],
  );
  return rows.length > 0;
}

/**
 * Derruba as sessoes de um usuario, opcionalmente poupando a atual.
 *
 * Trocar a senha usa isto: se a senha vazou, quem a usou continua dentro ate
 * o token vencer. Poupar a sessao corrente evita expulsar do sistema justamente
 * quem acabou de fazer a coisa certa.
 */
async function removeByUser(userId, { exceptId } = {}) {
  const params = [userId];
  let sql = 'DELETE FROM sessions WHERE user_id = $1';

  if (exceptId) {
    params.push(exceptId);
    sql += ` AND id <> $${params.length}`;
  }

  const { rowCount } = await db.query(`${sql} RETURNING id`, params);
  return rowCount;
}

/**
 * Limpeza das vencidas. Chamada no login, que e raro e ja e a requisicao mais
 * lenta do sistema — nao vale um processo em segundo plano so para isto.
 */
async function removeExpired() {
  const { rowCount } = await db.query(
    'DELETE FROM sessions WHERE expires_at <= now() RETURNING id',
  );
  return rowCount;
}

async function countByUser(userId) {
  const { rows } = await db.query(
    'SELECT COUNT(*)::int AS total FROM sessions WHERE user_id = $1',
    [userId],
  );
  return rows[0].total;
}

module.exports = {
  findActiveByTokenHash,
  create,
  removeByTokenHash,
  removeByUser,
  removeExpired,
  countByUser,
};
