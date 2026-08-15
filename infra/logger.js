'use strict';

const { randomUUID } = require('crypto');
const pino = require('pino');
const pinoHttp = require('pino-http');
const env = require('../src/config/env');

const isDevelopment = env.nodeEnv === 'development';

const logger = pino({
  // Em teste o log so poluiria a saida da suite.
  level: process.env.LOG_LEVEL || (env.isTest ? 'silent' : 'info'),

  // pino-pretty e devDependency: em producao o log sai em JSON, que e o que
  // um agregador consome.
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      }
    : undefined,

  redact: ['req.headers.authorization', 'req.headers.cookie'],
});

/**
 * Middleware de log por requisicao. Cada uma ganha um id, ecoado no header
 * `x-request-id` e devolvido no corpo dos erros 5xx — e o que liga a
 * reclamacao do usuario a linha de log correspondente.
 *
 * Um `x-request-id` que ja venha na requisicao e preservado, para que o
 * rastro atravesse proxies e outros servicos.
 */
const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const id = req.headers['x-request-id'] || randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },
  customLogLevel: (req, res, error) => {
    if (error || res.statusCode >= 500) {
      return 'error';
    }
    return res.statusCode >= 400 ? 'warn' : 'info';
  },

  // O padrao despeja todos os headers de requisicao e resposta em cada linha.
  // Aqui fica so o que se usa para investigar: quem chamou o que, e como saiu.
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});

module.exports = { logger, httpLogger };
