'use strict';

const { Router } = require('express');
const controller = require('../controllers/auth.controller');
const asyncHandler = require('../middlewares/async-handler');
const rejectOtherMethods = require('../middlewares/method-not-allowed');
const { requireAuth } = require('../middlewares/authorize');
const { authLimiter } = require('../middlewares/rate-limit');

const router = Router();

// A unica rota da API que responde sem sessao. Por isso tem teto proprio.
router.post('/login', authLimiter, asyncHandler(controller.login));

// Sair e ver-se a si mesmo nao pedem escopo nenhum: basta estar autenticado.
router.post('/logout', requireAuth, asyncHandler(controller.logout));
router.get('/me', requireAuth, asyncHandler(controller.me));

module.exports = rejectOtherMethods(router);
