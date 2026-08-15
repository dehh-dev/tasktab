'use strict';

const { Router } = require('express');
const taskRoutes = require('./task.routes');
const healthController = require('../controllers/health.controller');
const asyncHandler = require('../middlewares/async-handler');

const router = Router();

router.get('/health', asyncHandler(healthController.show));
router.use('/tasks', taskRoutes);

module.exports = router;
