'use strict';

const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const { BaseError } = require('../../infra/errors');

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/** 429 no mesmo formato de todo erro da API. */
class TooManyRequestsError extends BaseError {
  constructor({ message, action } = {}) {
    super({
      message: message || 'Requisicoes demais em pouco tempo.',
      action: action || 'Aguarde alguns instantes e tente de novo.',
      statusCode: 429,
    });
  }
}

function build({ max, skipRead = false }) {
  return rateLimit({
    windowMs: env.rateLimit.windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // A suite roda dezenas de requisicoes em segundos e trombaria em qualquer
    // teto realista. O limitador e verificado manualmente — veja o README.
    skip: (req) =>
      env.isTest || (skipRead && !WRITE_METHODS.includes(req.method)),
    handler: (req, res) => {
      const error = new TooManyRequestsError();
      res.status(error.statusCode).json(error.toJSON());
    },
  });
}

// Dois tetos sobrepostos: um geral, e um mais apertado so para escrita.
const readLimiter = build({ max: env.rateLimit.max });
const writeLimiter = build({ max: env.rateLimit.writeMax, skipRead: true });

module.exports = { readLimiter, writeLimiter, TooManyRequestsError };
