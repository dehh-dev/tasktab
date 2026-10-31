'use strict';

const { loadLaunch } = require('../services/auth/access.service');
const { loadGrid, saveDays } = require('../services/rpa/timesheet.service');
const { validateId } = require('../validators/rpa-launch.validator');
const validator = require('../validators/rpa-day.validator');

/** GET /api/rpa/launches/:id/days?from=&to= — a grade com o valor de cada dia. */
async function show(req, res) {
  const id = validateId(req.params.id);
  const query = validator.validateGridQuery(req.query);
  const launch = await loadLaunch(id);

  res.json({ data: await loadGrid(launch, query) });
}

/**
 * PUT /api/rpa/launches/:id/days — so os dias que mudam.
 *
 * O lancamento vem antes do corpo: id inexistente e 404 mesmo com o corpo
 * errado, e encerrado e 409 antes de qualquer conferencia.
 */
async function update(req, res) {
  const id = validateId(req.params.id);
  const launch = await loadLaunch(id, { write: true });
  const entries = validator.validateBatch(req.body);

  res.json({ data: await saveDays(launch, entries) });
}

module.exports = { show, update };
