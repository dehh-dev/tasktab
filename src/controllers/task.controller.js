'use strict';

const Task = require('../models/task.model');
const { NotFoundError } = require('../../infra/errors');
const validator = require('../validators/task.validator');

function taskNotFound(id) {
  return new NotFoundError({
    message: `Task ${id} nao encontrada.`,
    action: 'Verifique o id informado ou liste as tarefas disponiveis.',
  });
}

/** GET /api/tasks */
async function index(req, res) {
  const { status, limit, offset } = validator.validateListQuery(req.query);
  const [data, total] = await Promise.all([
    Task.findAll({ status, limit, offset }),
    Task.count({ status }),
  ]);

  res.json({ data, meta: { total, limit, offset } });
}

/** GET /api/tasks/:id */
async function show(req, res) {
  const id = validator.validateId(req.params.id);
  const task = await Task.findById(id);

  if (!task) {
    throw taskNotFound(id);
  }

  res.json({ data: task });
}

/** POST /api/tasks */
async function create(req, res) {
  const data = validator.validateCreate(req.body);
  const task = await Task.create(data);

  res.status(201).location(`/api/tasks/${task.id}`).json({ data: task });
}

/** PUT|PATCH /api/tasks/:id */
async function update(req, res) {
  const id = validator.validateId(req.params.id);
  const data = validator.validateUpdate(req.body);
  const task = await Task.update(id, data);

  if (!task) {
    throw taskNotFound(id);
  }

  res.json({ data: task });
}

/** DELETE /api/tasks/:id */
async function destroy(req, res) {
  const id = validator.validateId(req.params.id);
  const deleted = await Task.remove(id);

  if (!deleted) {
    throw taskNotFound(id);
  }

  res.status(204).send();
}

module.exports = { index, show, create, update, destroy };
