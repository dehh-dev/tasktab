'use strict';

const Report = require('../../models/report.model');
const Receipt = require('../../models/receipt.model');
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

module.exports = { loadReport, loadReceipt, receiptNotFound, reportClosed };
