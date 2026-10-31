'use strict';

const { Router } = require('express');
const companies = require('../controllers/rpa-company.controller');
const launches = require('../controllers/rpa-launch.controller');
const workers = require('../controllers/rpa-worker.controller');
const timesheet = require('../controllers/rpa-timesheet.controller');
const payments = require('../controllers/rpa-payment.controller');
const documents = require('../controllers/rpa-document.controller');
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
  '/launches/:id/days',
  requireScope('rpa:read'),
  asyncHandler(timesheet.show),
);
router.put(
  '/launches/:id/days',
  requireScope('rpa:write'),
  asyncHandler(timesheet.update),
);
router.get(
  '/launches/:id/payments',
  requireScope('rpa:read'),
  asyncHandler(payments.index),
);
router.post(
  '/launches/:id/payments',
  requireScope('rpa:write'),
  asyncHandler(payments.create),
);
router.get(
  '/launches/:id/rpas.zip',
  requireScope('rpa:read'),
  asyncHandler(documents.rpasZip),
);
router.get(
  '/launches/:id/email',
  requireScope('rpa:read'),
  asyncHandler(documents.email),
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

router.get(
  '/payments/:id',
  requireScope('rpa:read'),
  asyncHandler(payments.show),
);
router.get(
  '/payments/:id/rpa.pdf',
  requireScope('rpa:read'),
  asyncHandler(documents.rpaPdf),
);
router.post(
  '/payments/:id/cancel',
  requireScope('rpa:write'),
  asyncHandler(payments.cancel),
);

module.exports = rejectOtherMethods(router);
