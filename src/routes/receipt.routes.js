'use strict';

const { Router } = require('express');
const controller = require('../controllers/receipt.controller');
const asyncHandler = require('../middlewares/async-handler');
const rejectOtherMethods = require('../middlewares/method-not-allowed');
const { requireScope } = require('../middlewares/authorize');

const router = Router();

// Comprovante nao tem dono proprio: herda o do relatorio em que foi lancado.
// O controller carrega o relatorio pai antes de responder qualquer coisa —
// inclusive na rota de imagem, que e por onde o cupom com CNPJ (e as vezes
// CPF de terceiros) sairia.

router.post(
  '/:id/reprocess',
  requireScope('receipts:write'),
  asyncHandler(controller.reprocess),
);

router.get(
  '/:id/image',
  requireScope('receipts:read'),
  asyncHandler(controller.image),
);

router.get(
  '/:id',
  requireScope('receipts:read'),
  asyncHandler(controller.show),
);
router.patch(
  '/:id',
  requireScope('receipts:write'),
  asyncHandler(controller.update),
);
router.delete(
  '/:id',
  requireScope('receipts:write'),
  asyncHandler(controller.destroy),
);

module.exports = rejectOtherMethods(router);
