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

/**
 * Teto proprio das rotas de prestacao de contas. Revisar um lote de 30 cupons
 * sao 30 PATCH em poucos minutos, mais o upload — o teto geral de escrita
 * cortaria o usuario no meio do trabalho.
 */
const batchWriteLimiter = build({
  max: env.rateLimit.batchWriteMax,
  skipRead: true,
});

/**
 * Teto do login, bem mais apertado que o de escrita.
 *
 * E a unica rota do sistema onde repetir a requisicao com outro valor tem
 * serventia para quem nao deveria estar aqui: 20 tentativas por janela nao
 * incomodam quem errou a senha e inviabilizam percorrer uma lista de senhas.
 * O custo do `scrypt` ja atrasa cada tentativa; o limitador e o que impede
 * que essa mesma lentidao vire uma forma de ocupar a CPU do servidor.
 */
const authLimiter = build({ max: env.rateLimit.authMax });

module.exports = {
  readLimiter,
  writeLimiter,
  batchWriteLimiter,
  authLimiter,
  TooManyRequestsError,
};
