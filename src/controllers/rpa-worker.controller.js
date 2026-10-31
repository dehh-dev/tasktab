'use strict';

const Worker = require('../models/rpa-worker.model');
const Bank = require('../models/rpa-bank.model');
const { loadWorker } = require('../services/auth/access.service');
const { reconcileIssues } = require('../services/rpa/worker-issues');
const { ValidationError } = require('../../infra/errors');
const validator = require('../validators/rpa-worker.validator');

/** GET /api/rpa/workers/:id */
async function show(req, res) {
  const id = validator.validateId(req.params.id);
  const { worker } = await loadWorker(id);

  res.json({ data: worker });
}

/**
 * PATCH /api/rpa/workers/:id
 *
 * Inicio real, saida, promocao, dependentes, a correcao de um campo do
 * formulario e a pendencia dada por resolvida. As verificacoes rodam de novo
 * sobre o cadastro corrigido: arrumar o campo apaga a pendencia dele.
 */
async function update(req, res) {
  const id = validator.validateId(req.params.id);
  const { data, resolve } = validator.validateUpdate(req.body);
  const { worker, launch } = await loadWorker(id, { write: true });
  const errors = [];

  if (data.cpf && data.cpf !== worker.cpf) {
    const other = await Worker.findByCpf(worker.launch_id, data.cpf);
    if (other) {
      errors.push({
        field: 'cpf',
        message: 'ja ha outra pessoa com este CPF no lancamento',
      });
    }
  }

  if (data.bank_code && !(await Bank.exists(data.bank_code))) {
    errors.push({
      field: 'bank_code',
      message: 'bank_code nao esta na lista do Banco Central',
    });
  }

  const merged = { ...worker, ...data };

  if (merged.left_on && merged.starts_on && merged.left_on < merged.starts_on) {
    errors.push({ field: 'left_on', message: 'saida antes do inicio' });
  }

  if (errors.length > 0) {
    throw new ValidationError({ details: errors });
  }

  const changed = new Set(
    Object.keys(data).filter(
      (field) => String(data[field] ?? '') !== String(worker[field] ?? ''),
    ),
  );
  const issues = reconcileIssues({
    previous: worker.issues,
    merged,
    launch,
    changed,
    resolve,
  });

  res.json({ data: await Worker.update(id, { ...data, issues }) });
}

module.exports = { show, update };
