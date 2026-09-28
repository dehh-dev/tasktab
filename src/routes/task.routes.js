'use strict';

const { Router } = require('express');
const controller = require('../controllers/task.controller');
const asyncHandler = require('../middlewares/async-handler');
const { requireScope } = require('../middlewares/authorize');

const router = Router();

// O quadro de tarefas e compartilhado: nao ha `owner_id` em `tasks`, e o
// escopo sozinho decide. Se um dia cada pessoa precisar do seu quadro, o
// caminho e o mesmo dos relatorios — coluna de dono mais um `tasks:read:any`.
router.get('/', requireScope('tasks:read'), asyncHandler(controller.index));
router.post('/', requireScope('tasks:write'), asyncHandler(controller.create));
router.get('/:id', requireScope('tasks:read'), asyncHandler(controller.show));
router.put(
  '/:id',
  requireScope('tasks:write'),
  asyncHandler(controller.update),
);
router.patch(
  '/:id',
  requireScope('tasks:write'),
  asyncHandler(controller.update),
);
router.delete(
  '/:id',
  requireScope('tasks:write'),
  asyncHandler(controller.destroy),
);

module.exports = router;
