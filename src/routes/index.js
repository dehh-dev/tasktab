'use strict';

const { Router } = require('express');
const taskRoutes = require('./task.routes');
const reportRoutes = require('./report.routes');
const healthController = require('../controllers/health.controller');
const asyncHandler = require('../middlewares/async-handler');
const { batchWriteLimiter } = require('../middlewares/rate-limit');

const router = Router();

router.get('/health', asyncHandler(healthController.show));
router.use('/tasks', taskRoutes);

// Prestacao de contas trabalha em lote e tem teto proprio de escrita: revisar
// 30 cupons sao dezenas de PATCH seguidos de uma pessoa so.
router.use('/reports', batchWriteLimiter, reportRoutes);

module.exports = router;
