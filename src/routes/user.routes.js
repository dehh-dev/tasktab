'use strict';

const { Router } = require('express');
const controller = require('../controllers/user.controller');
const asyncHandler = require('../middlewares/async-handler');
const { requireAuth, requireScope } = require('../middlewares/authorize');

const router = Router();

router.get('/', requireScope('users:read'), asyncHandler(controller.index));
router.post('/', requireScope('users:write'), asyncHandler(controller.create));

// `show` e `update` aceitam tambem quem mexe no proprio cadastro, e isso
// depende do :id — algo que a rota nao tem como conferir. Aqui fica o piso
// (ter sessao); quem completa e o `ownership.assertCan*User` no controller.
router.get('/:id', requireAuth, asyncHandler(controller.show));
router.patch('/:id', requireAuth, asyncHandler(controller.update));

router.delete(
  '/:id',
  requireScope('users:write'),
  asyncHandler(controller.destroy),
);

module.exports = router;
