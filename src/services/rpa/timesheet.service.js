'use strict';

const db = require('../../config/database');
const Day = require('../../models/rpa-day.model');
const Worker = require('../../models/rpa-worker.model');
const { ValidationError } = require('../../../infra/errors');
const { daysBetween, latest, earliest } = require('./calendar');
const { dailyCentsFor } = require('./day-value');
const {
  workerPeriod,
  sameAsPlanned,
  noRateMessage,
  buildGrid,
} = require('./timesheet');

// Tres meses de grade: a equipe de 30 pessoas em 93 dias ainda e uma resposta
// de poucos MB. Lancamento mais longo se le por partes.
const MAX_RANGE_DAYS = 93;

function rangeOf(launch, query) {
  const from = latest(launch.starts_on, query.from);
  const to = earliest(launch.ends_on, query.to);

  if (from > to) {
    throw new ValidationError({
      message: 'O recorte pedido fica fora do lancamento.',
      action: `Peca datas entre ${launch.starts_on} e ${launch.ends_on}.`,
      details: [{ field: 'from', message: 'fora do periodo do lancamento' }],
    });
  }

  return { from, to };
}

/**
 * A grade de `from` a `to`, recortada pelo lancamento. `capped: false` e so
 * para a resposta do PUT, que devolve o trecho que acabou de gravar.
 */
async function loadGrid(launch, query = {}, { capped = true } = {}) {
  const range = rangeOf(launch, query);
  const length = daysBetween(range.from, range.to);

  if (capped && length > MAX_RANGE_DAYS) {
    throw new ValidationError({
      message: `O recorte tem ${length} dias; o maximo e ${MAX_RANGE_DAYS}.`,
      action: `Informe from e to com ate ${MAX_RANGE_DAYS} dias.`,
      details: [{ field: 'to', message: `ate ${MAX_RANGE_DAYS} dias` }],
    });
  }

  const [workers, exceptions] = await Promise.all([
    Worker.findRoster(launch.id),
    Day.findByLaunch(launch.id, range.from, range.to),
  ]);

  return buildGrid({ launch, workers, exceptions, ...range });
}

/**
 * Separa o lote em excecoes a gravar e dias que voltam ao padrao, e recusa o
 * lote inteiro se algum dia nao serve: pessoa de outro lancamento, data fora
 * do periodo dela, ou dia trabalhado sem diaria vigente — o `#N/D` da
 * planilha, aqui com a data e a funcao.
 *
 * Tirar a excecao vale mesmo fora do periodo: e o caminho para limpar o dia
 * de quem teve a saida antecipada depois de lancado.
 */
function planBatch(launch, roster, entries) {
  const workers = new Map(roster.map((worker) => [worker.id, worker]));
  const errors = [];
  const upserts = [];
  const removals = [];

  for (const entry of entries) {
    const at = (name) => `days[${entry.index}].${name}`;
    const worker = workers.get(entry.worker_id);

    if (!worker) {
      errors.push({
        field: at('worker_id'),
        message: 'a pessoa nao e deste lancamento',
      });
      continue;
    }

    if (entry.reset) {
      removals.push(entry);
      continue;
    }

    const period = workerPeriod(launch, worker);

    if (!period || entry.date < period.first || entry.date > period.last) {
      errors.push({
        field: at('date'),
        message: period
          ? `fora do periodo da pessoa (${period.first} a ${period.last})`
          : 'a pessoa nao tem dia no lancamento',
      });
      continue;
    }

    if (sameAsPlanned(entry, launch, entry.date)) {
      removals.push(entry);
      continue;
    }

    if (
      entry.quantity > 0 &&
      dailyCentsFor(launch.rates, worker, entry.date) === null
    ) {
      errors.push({
        field: at('date'),
        message: noRateMessage(worker, entry.date),
        date: entry.date,
        role: worker.role,
      });
      continue;
    }

    upserts.push(entry);
  }

  if (errors.length > 0) {
    throw new ValidationError({
      action: 'Corrija os dias indicados; nenhum dia do lote foi gravado.',
      details: errors,
    });
  }

  return { upserts, removals };
}

/**
 * Grava o lote numa transacao e devolve a grade do trecho gravado. O numero
 * de consultas nao depende do tamanho do lote.
 *
 * Dia ja pago pode mudar: a diferenca vira correcao no pagamento seguinte
 * (issue 39), que compara o que foi pago com o que a grade calcula agora.
 */
async function saveDays(launch, entries) {
  const roster = await Worker.findRoster(launch.id);
  const { upserts, removals } = planBatch(launch, roster, entries);

  await db.transaction(async (client) => {
    await Day.upsert(client, upserts);
    await Day.remove(client, removals);
  });

  const dates = entries.map((entry) => entry.date).sort();

  return loadGrid(
    launch,
    { from: dates[0], to: dates.at(-1) },
    { capped: false },
  );
}

module.exports = { MAX_RANGE_DAYS, loadGrid, saveDays };
