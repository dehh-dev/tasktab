'use strict';

const { Router } = require('express');
const companies = require('../controllers/rpa-company.controller');
const asyncHandler = require('../middlewares/async-handler');
const rejectOtherMethods = require('../middlewares/method-not-allowed');
const { requireScope } = require('../middlewares/authorize');

const router = Router();

// Modulo RPA (issues 35 a 43). Lancamento, equipe e pagamentos sao
// compartilhados entre quem tem `rpa:*`, como tarefas e emitentes: o escopo
// sozinho decide quem le e quem escreve.

router.get(
  '/companies',
  requireScope('rpa:read'),
  asyncHandler(companies.index),
);
router.post(
  '/companies',
  requireScope('rpa:write'),
  asyncHandler(companies.create),
);
router.get(
  '/companies/:id',
  requireScope('rpa:read'),
  asyncHandler(companies.show),
);
router.patch(
  '/companies/:id',
  requireScope('rpa:write'),
  asyncHandler(companies.update),
);

module.exports = rejectOtherMethods(router);
