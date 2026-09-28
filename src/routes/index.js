'use strict';

const { Router } = require('express');
const taskRoutes = require('./task.routes');
const reportRoutes = require('./report.routes');
const receiptRoutes = require('./receipt.routes');
const merchantRoutes = require('./merchant.routes');
const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const healthController = require('../controllers/health.controller');
const asyncHandler = require('../middlewares/async-handler');
const authenticate = require('../middlewares/authenticate');
const { batchWriteLimiter } = require('../middlewares/rate-limit');

const router = Router();

// Resolve a sessao para toda a API, sem barrar ninguem: quem exige credencial
// e o `requireScope` de cada rota. A ordem importa — montado aqui em cima,
// nenhuma rota nova nasce sem `req.user` preenchido.
router.use(authenticate);

// Publico de proposito: o probe do container consulta isto, e um health check
// que exige sessao nao serve para dizer se a aplicacao esta de pe.
router.get('/health', asyncHandler(healthController.show));

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/tasks', taskRoutes);

// Prestacao de contas trabalha em lote e tem teto proprio de escrita: revisar
// 30 cupons sao dezenas de PATCH seguidos de uma pessoa so.
router.use('/reports', batchWriteLimiter, reportRoutes);
router.use('/receipts', batchWriteLimiter, receiptRoutes);
router.use('/merchants', batchWriteLimiter, merchantRoutes);

module.exports = router;
