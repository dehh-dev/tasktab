'use strict';

const { Router } = require('express');
const controller = require('../controllers/report.controller');
const asyncHandler = require('../middlewares/async-handler');

const router = Router();

router.get('/', asyncHandler(controller.index));
router.post('/', asyncHandler(controller.create));
router.get('/:id', asyncHandler(controller.show));
router.patch('/:id', asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.destroy));

module.exports = router;
