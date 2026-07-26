'use strict';

const { Router } = require('express');
const taskRoutes = require('./task.routes');

const router = Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

router.use('/tasks', taskRoutes);

module.exports = router;
