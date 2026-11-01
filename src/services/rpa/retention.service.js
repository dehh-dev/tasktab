'use strict';

const db = require('../../config/database');
const Launch = require('../../models/rpa-launch.model');
const Worker = require('../../models/rpa-worker.model');
const RpaFile = require('../../models/rpa-file.model');
const { discardOrphans } = require('../retention.service');
const { logger } = require('../../../infra/logger');

// A varredura roda na subida da API e depois a cada seis horas: o prazo e de
// um mes, e meio dia a mais nao muda nada para quem conferiu o lancamento.
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Um lancamento vencido perde, numa transacao, os documentos, os recibos e os
 * dados pessoais da equipe; o lancamento fica marcado. O disco e limpo so
 * depois do commit, pela contagem por referencia: o mesmo arquivo pode ser
 * de outro lancamento ou de um comprovante.
 */
async function purgeLaunch(id, log) {
  const purged = await db.transaction(async (client) => {
    if (!(await Launch.lockExpired(client, id))) return null;

    const files = await RpaFile.deleteByLaunch(client, id);
    const workers = await Worker.erasePersonalData(client, id);
    await Launch.markPurged(client, id);

    return { files, workers };
  });

  if (!purged) return false;

  await discardOrphans(purged.files, log);
  // So contagens: nome, CPF e arquivo nao entram no log.
  log.info(
    {
      launch_id: id,
      files: purged.files.length,
      workers: purged.workers,
    },
    'retencao do RPA: dados pessoais do lancamento apagados',
  );
  return true;
}

/** Aplica a retencao a todo lancamento vencido. Devolve quantos apagou. */
async function purgeExpired(log = logger) {
  let purged = 0;

  for (const id of await Launch.findExpired()) {
    if (await purgeLaunch(id, log)) purged += 1;
  }

  return purged;
}

/**
 * Liga a varredura: uma vez agora e depois no intervalo. Falha vira aviso e a
 * proxima rodada tenta de novo — a API nao cai por causa dela. Devolve a
 * funcao que desliga.
 */
function startRetentionSweep(log = logger) {
  const run = () =>
    purgeExpired(log).catch((error) =>
      log.warn({ err: error }, 'retencao do RPA nao rodou'),
    );

  run();
  const timer = setInterval(run, SWEEP_INTERVAL_MS);
  timer.unref();

  return () => clearInterval(timer);
}

module.exports = { purgeExpired, startRetentionSweep };
