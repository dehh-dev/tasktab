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
async function show(req, res) {
  try {
    await db.query('SELECT 1');
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
