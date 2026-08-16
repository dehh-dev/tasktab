'use strict';

const { Router } = require('express');
const controller = require('../controllers/receipt.controller');
const asyncHandler = require('../middlewares/async-handler');

const router = Router();

router.get('/:id', asyncHandler(controller.show));
router.patch('/:id', asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.destroy));

module.exports = router;
