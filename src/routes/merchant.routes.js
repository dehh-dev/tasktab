'use strict';

const { Router } = require('express');
const controller = require('../controllers/merchant.controller');
const asyncHandler = require('../middlewares/async-handler');

const router = Router();

// Antes de `/:id`, senao "by-cnpj" seria lido como id e viraria 400.
router.get('/by-cnpj/:cnpj', asyncHandler(controller.showByCnpj));

router.get('/', asyncHandler(controller.index));
router.post('/', asyncHandler(controller.create));
router.patch('/:id', asyncHandler(controller.update));

module.exports = router;
