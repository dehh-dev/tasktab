'use strict';

const { Router } = require('express');
const controller = require('../controllers/merchant.controller');
const asyncHandler = require('../middlewares/async-handler');
const rejectOtherMethods = require('../middlewares/method-not-allowed');
const { requireScope } = require('../middlewares/authorize');

const router = Router();

// Cadastro compartilhado, sem dono: a categoria de um CNPJ e a mesma para todo
// mundo, e duplicar o cadastro por pessoa faria a mesma padaria ser
// classificada de dois jeitos. O escopo sozinho decide quem escreve nele.

// Antes de `/:id`, senao "by-cnpj" seria lido como id e viraria 400.
router.get(
  '/by-cnpj/:cnpj',
  requireScope('merchants:read'),
  asyncHandler(controller.showByCnpj),
);

router.get('/', requireScope('merchants:read'), asyncHandler(controller.index));
router.post(
  '/',
  requireScope('merchants:write'),
  asyncHandler(controller.create),
);
router.get(
  '/:id',
  requireScope('merchants:read'),
  asyncHandler(controller.show),
);
router.patch(
  '/:id',
  requireScope('merchants:write'),
  asyncHandler(controller.update),
);

module.exports = rejectOtherMethods(router);
