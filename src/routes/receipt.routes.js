'use strict';

const { Router } = require('express');
const controller = require('../controllers/receipt.controller');
const asyncHandler = require('../middlewares/async-handler');

const router = Router();

router.post('/:id/reprocess', asyncHandler(controller.reprocess));

router.get('/:id/image', asyncHandler(controller.image));

router.get('/:id', asyncHandler(controller.show));
router.patch('/:id', asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.destroy));

module.exports = router;
