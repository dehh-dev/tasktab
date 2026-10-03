'use strict';

const pipeline = require('./extraction/pipeline.service');
const parsers = require('./extraction/parsers');
const dedup = require('./dedup.service');

/**
 * O que uma chave de acesso digitada na revisao muda no comprovante.
 *
 * A chave e o que o procedimento de prestacao de contas chama de fonte da
 * verdade para emitente e data, e quando o QR e o texto falham a extracao a
 * perde. Digitada por uma pessoa (e ja conferida pelo DV no validator), ela
 * vale o mesmo que a lida do QR, entao segue o mesmo caminho:
 *
 * - o emitente sai do CNPJ das posicoes 7 a 20, pelo `classify` da extracao,
 *   que cadastra o CNPJ desconhecido — o nome vem do texto da pagina, quando
 *   ha;
 * - a categoria do cadastro do emitente substitui um palpite, nunca uma
 *   escolha de pessoa: nem a que veio neste mesmo PATCH, nem a ja gravada sem
 *   a marca de palpite;
 * - a mesma chave em outro comprovante do relatorio e o mesmo documento
 *   fiscal, e este vira a duplicata dele, como na extracao — por cima de um
 *   "confirmar" que viesse junto.
 */
async function applyTypedAccessKey(current, data) {
  const key = data.access_key;
  const text = current.raw_text ?? '';
  const { fields } = parsers.parse(text);

  const classified = await pipeline.classify(
    key.slice(6, 20),
    parsers.merchantName(text),
    fields.city?.value ?? null,
  );

  // Sem emitente (CNPJ que nao fecha o proprio DV), fica o que o texto deu:
  // gravar nulo desvincularia um emitente sem colocar outro no lugar.
  const changes =
    classified.merchant_id === null
      ? {}
      : { merchant_id: classified.merchant_id };

  const personChose =
    'category' in data ||
    (current.category !== null && !current.category_guessed);

  if (!personChose && !classified.category_guessed) {
    changes.category = classified.category;
    changes.category_guessed = false;
  }

  const original = await dedup.findExactDuplicate({
    id: current.id,
    report_id: current.report_id,
    access_key: key,
  });

  if (original) {
    changes.status = 'duplicate';
    changes.duplicate_of_id = original.id;
  }

  return changes;
}

module.exports = { applyTypedAccessKey };
