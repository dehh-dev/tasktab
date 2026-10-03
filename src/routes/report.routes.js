'use strict';

const { Router } = require('express');
const controller = require('../controllers/report.controller');
const receiptController = require('../controllers/receipt.controller');
const asyncHandler = require('../middlewares/async-handler');
const rejectOtherMethods = require('../middlewares/method-not-allowed');
const { receiptUpload } = require('../middlewares/upload');
const { requireScope } = require('../middlewares/authorize');

const router = Router();

// O escopo diz **o que** a sessao pode fazer; quem diz **em quais relatorios**
// e o `ownership` dentro do controller, que so consegue decidir depois de
// carregar a linha. Os dois eixos sao obrigatorios: escopo sem posse deixaria
// um usuario editar o relatorio do outro.

router.post(
  '/:id/receipts',
  requireScope('receipts:write'),
  receiptUpload,
  asyncHandler(receiptController.upload),
);

router.get(
  '/:id/receipts',
  requireScope('receipts:read'),
  asyncHandler(receiptController.index),
);
router.get(
  '/:id/validation',
  requireScope('reports:read'),
  asyncHandler(controller.validate),
);

// As exportacoes levam o relatorio inteiro num arquivo — cupom, CNPJ e valor.
// Sao leitura de relatorio, e passam pela mesma posse.
router.get(
  '/:id/export.xlsx',
  requireScope('reports:read'),
  asyncHandler(controller.exportXlsx),
);
router.get(
  '/:id/export/anexo-i.xlsx',
  requireScope('reports:read'),
  asyncHandler(controller.exportAnexoI),
);
router.get(
  '/:id/export.pdf',
  requireScope('reports:read'),
  asyncHandler(controller.exportPdf),
);
router.get(
  '/:id/export/pdfs-por-categoria.zip',
  requireScope('reports:read'),
  asyncHandler(controller.exportCategoryPdfs),
);

router.get('/', requireScope('reports:read'), asyncHandler(controller.index));
router.post(
  '/',
  requireScope('reports:write'),
  asyncHandler(controller.create),
);
router.get('/:id', requireScope('reports:read'), asyncHandler(controller.show));
router.patch(
  '/:id',
  requireScope('reports:write'),
  asyncHandler(controller.update),
);
router.delete(
  '/:id',
  requireScope('reports:write'),
  asyncHandler(controller.destroy),
);

module.exports = rejectOtherMethods(router);
