'use strict';

const { Router } = require('express');
const companies = require('../controllers/rpa-company.controller');
const launches = require('../controllers/rpa-launch.controller');
const workers = require('../controllers/rpa-worker.controller');
const asyncHandler = require('../middlewares/async-handler');
const rejectOtherMethods = require('../middlewares/method-not-allowed');
const { requireScope } = require('../middlewares/authorize');
const { spreadsheetUpload } = require('../middlewares/upload');

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

router.get('/launches', requireScope('rpa:read'), asyncHandler(launches.index));
router.post(
  '/launches',
  requireScope('rpa:write'),
  asyncHandler(launches.create),
);
router.get(
  '/launches/:id',
  requireScope('rpa:read'),
  asyncHandler(launches.show),
);
router.patch(
  '/launches/:id',
  requireScope('rpa:write'),
  asyncHandler(launches.update),
);
router.delete(
  '/launches/:id',
  requireScope('rpa:write'),
  asyncHandler(launches.destroy),
);
// O escopo antes do upload: quem nao pode escrever recebe 403 sem que a
// planilha, com CPF e conta da equipe, chegue a ser lida.
router.post(
  '/launches/:id/import',
  requireScope('rpa:write'),
  spreadsheetUpload,
  asyncHandler(launches.importTeam),
);
router.get(
  '/launches/:id/workers',
  requireScope('rpa:read'),
  asyncHandler(launches.workers),
);

router.get(
  '/workers/:id',
  requireScope('rpa:read'),
  asyncHandler(workers.show),
);
router.patch(
  '/workers/:id',
  requireScope('rpa:write'),
  asyncHandler(workers.update),
);

module.exports = rejectOtherMethods(router);
