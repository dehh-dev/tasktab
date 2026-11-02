'use strict';

const Report = require('../../models/report.model');
const Receipt = require('../../models/receipt.model');
const Launch = require('../../models/rpa-launch.model');
const Worker = require('../../models/rpa-worker.model');
const Payment = require('../../models/rpa-payment.model');
const RpaFile = require('../../models/rpa-file.model');
const RpaReceiptBatch = require('../../models/rpa-receipt-batch.model');
const { NotFoundError, ConflictError } = require('../../../infra/errors');
const ownership = require('./ownership');

/**
 * O unico caminho de um controller ate um relatorio ou comprovante: carregar
 * ja conferindo a posse.
 *
 * As funcoes devolvem o registro em vez de so validar, porque usar o retorno
 * e mais comodo que pular a checagem — um caminho que carregue o registro por
 * fora daqui e um vazamento esperando acontecer. E ficam num lugar so para que
 * o 404 de "nao existe" e o de "nao e seu" nao tenham como divergir: e a
 * igualdade das duas respostas que impede varrer os ids.
 */

function receiptNotFound(id) {
  return new NotFoundError({
    message: `Receipt ${id} nao encontrado.`,
    action: 'Verifique o id informado ou liste os comprovantes do relatorio.',
  });
}

/**
 * Relatorio fechado e somente leitura, ate para quem e dono: e o que foi
 * assinado. A checagem vem **depois** da posse, para quem nao alcanca o
 * relatorio continuar recebendo o 404 de sempre, e nao um 409 que confirmaria
 * que ele existe.
 */
function reportClosed(id) {
  return new ConflictError({
    message: `O relatorio ${id} esta fechado.`,
    action: 'Reabra o relatorio para alterar os comprovantes dele.',
  });
}

function assertOpen(report) {
  if (report.status === 'closed') {
    throw reportClosed(report.id);
  }
}

/**
 * `allowClosed` existe para um chamador so: o PATCH do proprio relatorio, que
 * e por onde ele e reaberto. Quem decide o que passa ali e o controller.
 */
async function loadReport(
  user,
  id,
  { write = false, allowClosed = false } = {},
) {
  const report = await Report.findById(id);

  if (!report) {
    throw ownership.reportNotFound(id);
  }

  if (write) {
    ownership.assertCanWriteReport(user, report);

    if (!allowClosed) {
      assertOpen(report);
    }
  } else {
    ownership.assertCanReadReport(user, report);
  }

  return report;
}

/**
 * Comprovante nao tem dono proprio: herda a posse do relatorio em que foi
 * lancado. Custa uma consulta a mais, e ela paga por si — a rota de imagem, a
 * que devolve o cupom com CNPJ e as vezes CPF de terceiros, passa por aqui
 * como todas as outras.
 *
 * Quando a pessoa nao alcanca o relatorio, a resposta e o 404 do
 * **comprovante**: dizer "esse relatorio nao e seu" ja entregaria que a
 * pagina existe e a qual relatorio pertence.
 */
async function loadReceipt(user, id, { write = false } = {}) {
  const receipt = await Receipt.findById(id);

  if (!receipt) {
    throw receiptNotFound(id);
  }

  const report = await Report.findById(receipt.report_id);

  if (!report || !ownership.canReadReport(user, report)) {
    throw receiptNotFound(id);
  }

  // Ja leu o recurso, entao esconder a existencia dele nao adianta mais: aqui
  // o 403 e honesto e diz o que falta. E o caso do auditor, que le o
  // comprovante dos outros e nao escreve em nenhum.
  if (write) {
    ownership.assertCanWriteReport(user, report);
    assertOpen(report);
  }

  return receipt;
}

function launchNotFound(id) {
  return new NotFoundError({
    message: `Lancamento ${id} nao encontrado.`,
    action: 'Verifique o id informado ou liste os lancamentos.',
  });
}

function workerNotFound(id) {
  return new NotFoundError({
    message: `Pessoa ${id} nao encontrada.`,
    action: 'Verifique o id informado ou liste a equipe do lancamento.',
  });
}

function paymentNotFound(id) {
  return new NotFoundError({
    message: `Pagamento ${id} nao encontrado.`,
    action: 'Verifique o id informado ou liste os pagamentos do lancamento.',
  });
}

function rpaFileNotFound(id) {
  return new NotFoundError({
    message: `Documento ${id} nao encontrado.`,
    action: 'Verifique o id informado ou liste os documentos do lancamento.',
  });
}

/**
 * Lancamento encerrado e somente leitura, como o relatorio fechado: e o que
 * ja foi pago. A excecao e o PATCH que reabre (`allowClosed`).
 */
function launchClosed(id) {
  return new ConflictError({
    message: `O lancamento ${id} esta encerrado.`,
    action: 'Reabra o lancamento para alterar a equipe ou os pagamentos.',
  });
}

/**
 * A retencao ja apagou os dados pessoais (um mes depois de encerrar): o que
 * dependia deles, como o PDF do RPA e reabrir, nao volta.
 */
function launchPurged(launch) {
  const day = launch.purged_on.split('-').reverse().join('/');
  return new ConflictError({
    message: `O lancamento ${launch.id} teve os dados pessoais apagados pela retencao em ${day}.`,
    action:
      'Os valores dos RPAs continuam no historico; a via assinada fica com o financeiro.',
  });
}

/**
 * O lancamento do RPA. Nao tem dono: e compartilhado entre quem tem `rpa:*`,
 * como tarefas e emitentes, e o escopo ja foi conferido na rota. Fica aqui
 * mesmo assim para o 404 sair de um lugar so, como no `loadReport`.
 */
async function loadLaunch(id, { write = false, allowClosed = false } = {}) {
  const launch = await Launch.findById(id);

  if (!launch) {
    throw launchNotFound(id);
  }

  if (write && !allowClosed && launch.status === 'closed') {
    throw launchClosed(id);
  }

  return launch;
}

/** A pessoa e o lancamento dela, ja com a trava do encerrado na escrita. */
async function loadWorker(id, { write = false } = {}) {
  const worker = await Worker.findById(id);

  if (!worker) {
    throw workerNotFound(id);
  }

  const launch = await loadLaunch(worker.launch_id, { write });

  return { worker, launch };
}

/**
 * O RPA e o lancamento dele. Na escrita (cancelar), o lancamento encerrado e
 * 409 como em todo o resto; o estado do proprio RPA quem confere e quem
 * escreve, porque cada escrita tem a sua regra.
 */
async function loadPayment(id, { write = false } = {}) {
  const payment = await Payment.findById(id);

  if (!payment) {
    throw paymentNotFound(id);
  }

  const launch = await loadLaunch(payment.launch_id, { write });

  return { payment, launch };
}

/** O envio de recibos assinados e o lancamento dele. */
async function loadReceiptBatch(id) {
  const batch = await RpaReceiptBatch.findById(id);

  if (!batch) {
    throw new NotFoundError({
      message: `Envio de recibos ${id} nao encontrado.`,
      action: 'Use o id devolvido pelo envio do PDF dos recibos.',
    });
  }

  const launch = await loadLaunch(batch.launch_id);

  return { batch, launch };
}

/** O documento do formulario e o lancamento dele, com a trava do encerrado. */
async function loadRpaFile(id, { write = false } = {}) {
  const file = await RpaFile.findById(id);

  if (!file) {
    throw rpaFileNotFound(id);
  }

  const launch = await loadLaunch(file.launch_id, { write });

  return { file, launch };
}

module.exports = {
  launchPurged,
  loadReceiptBatch,
  loadRpaFile,
  loadReport,
  loadReceipt,
  loadLaunch,
  loadWorker,
  loadPayment,
  receiptNotFound,
  reportClosed,
  launchNotFound,
};
