'use strict';

const db = require('../config/database');
const { ServiceError } = require('../../infra/errors');

/**
 * GET /api/health
 *
 * Consulta o banco de verdade. Um health check que so responde "ok" porque o
 * processo esta vivo mente justamente no cenario em que alguem o consulta —
 * banco fora do ar — e faz o load balancer seguir mandando trafego para ca.
 */
// Curto de proposito: um health check que demora e tao inutil quanto um que
// mente, porque o probe do orquestrador desiste antes da resposta.
const DATABASE_TIMEOUT_MS = 2000;

async function show(req, res) {
  try {
    await db.queryWithTimeout('SELECT 1', [], DATABASE_TIMEOUT_MS);
  } catch (error) {
    throw new ServiceError({
      message: 'Banco de dados indisponivel.',
      action: 'Verifique se o Postgres esta no ar e aceitando conexoes.',
      cause: error,
    });
  }

  res.json({ data: { status: 'ok', uptime: process.uptime() } });
}

module.exports = { show };
