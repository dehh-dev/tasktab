'use strict';

const { Router } = require('express');
const controller = require('../controllers/report.controller');
const receiptController = require('../controllers/receipt.controller');
const asyncHandler = require('../middlewares/async-handler');
const { receiptUpload } = require('../middlewares/upload');

const router = Router();

router.post(
  '/:id/receipts',
  receiptUpload,
  asyncHandler(receiptController.upload),
);

router.get('/:id/receipts', asyncHandler(receiptController.index));
router.get('/:id/validation', asyncHandler(controller.validate));

router.get('/:id/export.xlsx', asyncHandler(controller.exportXlsx));
router.get('/:id/export/anexo-i.xlsx', asyncHandler(controller.exportAnexoI));

router.get('/', asyncHandler(controller.index));
router.post('/', asyncHandler(controller.create));
router.get('/:id', asyncHandler(controller.show));
router.patch('/:id', asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.destroy));

module.exports = router;
