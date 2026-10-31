'use strict';

const JSZip = require('jszip');
const Payment = require('../../models/rpa-payment.model');
const { ConflictError, ValidationError } = require('../../../infra/errors');
const { buildRpaPdf } = require('./rpa-pdf.service');
const { rpaFileName, requestEmail } = require('./rpa-format');

/**
 * A emissao em lote (issue 40): o PDF de cada RPA, o .zip do n-esimo
 * pagamento e o texto do e-mail de solicitacao. Tudo sai do que foi gravado
 * na emissao — codigo, valores, tabelas e hora —, entao gerar de novo da o
 * mesmo arquivo com o mesmo nome.
 */

/**
 * Sem tipo de servico e centro de custo o RPA saia com `0` da planilha
 * (EMPRESA vazia para a 815 e a 803). Aqui ele nao sai.
 */
function assertPrintable(launch) {
  const missing = ['service_type', 'cost_center'].filter(
    (field) => !launch[field],
  );

  if (missing.length > 0) {
    throw new ValidationError({
      message: 'O lancamento nao tem tipo de servico ou centro de custo.',
      action: 'Preencha os dois no lancamento (ou na empresa) e gere de novo.',
      details: missing.map((field) => ({
        field,
        message: `${field} e obrigatorio para emitir o RPA`,
      })),
    });
  }
}

function fileNameOf(rpa) {
  return rpaFileName({
    number: rpa.number,
    workerName: rpa.worker.name,
    issuedAt: rpa.issued_at,
  });
}

/** O PDF de um RPA. Cancelado nao se imprime: nao vale para o financeiro. */
async function paymentPdf(id) {
  const rpa = await Payment.findDocument(id);

  if (rpa.status === 'canceled') {
    throw new ConflictError({
      message: `O RPA ${rpa.code} esta cancelado.`,
      action: 'Imprima o RPA emitido no lugar dele.',
    });
  }

  assertPrintable(rpa.launch);

  return { fileName: fileNameOf(rpa), buffer: await buildRpaPdf([rpa]) };
}

async function rpasOf(launch, number) {
  const rpas = await Payment.findDocumentsByNumber(launch.id, number);

  if (rpas.length === 0) {
    throw new ValidationError({
      message: `O lancamento nao tem RPA valido do ${number}º pagamento.`,
      action: 'Confira o numero do pagamento na lista de pagamentos.',
      details: [{ field: 'payment', message: 'nenhum RPA com este numero' }],
    });
  }

  return rpas;
}

/**
 * Um PDF por pessoa, com o nome que o arquivo solto teria. Duas pessoas com o
 * mesmo primeiro e ultimo nome emitidas no mesmo segundo ganham o numero da
 * pessoa no fim, para uma nao sobrescrever a outra no .zip.
 */
async function launchZip(launch, number) {
  assertPrintable(launch);

  const rpas = await rpasOf(launch, number);
  const zip = new JSZip();
  const used = new Set();

  for (const rpa of rpas) {
    let name = fileNameOf(rpa);
    if (used.has(name)) {
      name = name.replace(/\.pdf$/, ` (${rpa.worker.number}).pdf`);
    }
    used.add(name);

    zip.file(name, await buildRpaPdf([rpa]), {
      date: new Date(rpa.issued_at),
    });
  }

  const place = `${launch.city}-${launch.state}`;
  return {
    fileName: `RPAs - ${number}ª Pagto - ${place}.zip`,
    buffer: await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    }),
  };
}

async function launchEmail(launch, number) {
  const rpas = await rpasOf(launch, number);
  const paymentDates = [...new Set(rpas.map((rpa) => rpa.payment_date))].sort();

  return {
    payment: number,
    count: rpas.length,
    ...requestEmail({ launch, number, paymentDates, count: rpas.length }),
  };
}

module.exports = { paymentPdf, launchZip, launchEmail };
