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
const rejectOtherMethods = require('../middlewares/method-not-allowed');
const authenticate = require('../middlewares/authenticate');
const {
  writeLimiter,
  batchWriteLimiter,
} = require('../middlewares/rate-limit');

const router = Router();

// Um teto de escrita por familia de rota, e um so. Prestacao de contas
// trabalha em lote e tem o seu: revisar 30 cupons sao dezenas de PATCH
// seguidos de uma pessoa so. Antes do `authenticate`, para que o excesso seja
// recusado sem consultar sessao no banco.
router.use(['/auth', '/users', '/tasks'], writeLimiter);
router.use(['/reports', '/receipts', '/merchants'], batchWriteLimiter);

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

router.use('/reports', reportRoutes);
router.use('/receipts', receiptRoutes);
router.use('/merchants', merchantRoutes);

// So o `/health` e rota propria daqui; os sub-routers ja cuidam dos seus.
module.exports = rejectOtherMethods(router);
