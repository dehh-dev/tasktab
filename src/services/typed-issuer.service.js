'use strict';

const pipeline = require('./extraction/pipeline.service');
const parsers = require('./extraction/parsers');
const dedup = require('./dedup.service');

/**
 * O que a revisao muda no comprovante quando uma pessoa informa quem o
 * emitiu: a chave de acesso (issue 41) ou, sem chave, o CNPJ (issue 42).
 *
 * A chave e o que o procedimento de prestacao de contas chama de fonte da
 * verdade para emitente e data, e quando o QR e o texto falham a extracao a
 * perde. Digitada por uma pessoa (e ja conferida pelo DV no validator), ela
 * vale o mesmo que a lida do QR. O CNPJ cobre o comprovante sem chave — o
 * recibo com carimbo, a comanda. Os dois seguem o caminho da extracao:
 *
 * - o emitente sai do CNPJ pelo `classify`, que cadastra o desconhecido com o
 *   nome e a cidade que o comprovante traz;
 * - a categoria do cadastro do emitente substitui um palpite, nunca uma
 *   escolha de pessoa: nem a que veio neste mesmo PATCH, nem a ja gravada sem
 *   a marca de palpite. O palpite devolvido igual, como a tela faz ao
 *   confirmar, continua palpite;
 * - a mesma chave em outro comprovante do relatorio e o mesmo documento
 *   fiscal, e este vira a duplicata dele, como na extracao — por cima de um
 *   "confirmar" que viesse junto.
 */
async function applyTypedIssuer(current, data) {
  if (data.access_key) {
    const changes = await linkMerchant(
      current,
      data,
      data.access_key.slice(6, 20),
    );
    const original = await dedup.findExactDuplicate({
      id: current.id,
      report_id: current.report_id,
      access_key: data.access_key,
    });

    if (original) {
      changes.status = 'duplicate';
      changes.duplicate_of_id = original.id;
    }

    return changes;
  }

  if (data.cnpj === null) {
    return { merchant_id: null };
  }

  if (data.cnpj) {
    return linkMerchant(current, data, data.cnpj);
  }

  return {};
}

async function linkMerchant(current, data, cnpj) {
  const { name, city } = issuerOf(current, data);
  const classified = await pipeline.classify(cnpj, name, city);

  // Sem emitente (CNPJ que nao fecha o proprio DV), fica o que havia: gravar
  // nulo desvincularia um emitente sem colocar outro no lugar.
  const changes =
    classified.merchant_id === null
      ? {}
      : { merchant_id: classified.merchant_id };

  // A revisao manda a categoria inteira ao confirmar, mexendo nela ou nao:
  // devolver o mesmo palpite nao e escolher. Contado como escolha, o cupom
  // de posto confirmado com a chave digitada saia como Alimentacao, o piso
  // do palpite, mesmo com o emitente cadastrado como Combustivel.
  const keptGuess =
    'category' in data &&
    current.category_guessed &&
    data.category === current.category;
  const personChose =
    ('category' in data && !keptGuess) ||
    (current.category !== null && !current.category_guessed);

  if (!personChose && !classified.category_guessed) {
    changes.category = classified.category;
    changes.category_guessed = false;
  }

  return changes;
}

/**
 * Nome e cidade para cadastrar o emitente: o que a pessoa acabou de digitar,
 * o que o comprovante ja guardava, ou, para o extraido antes de as colunas
 * existirem, o que o texto da pagina diz.
 */
function issuerOf(current, data) {
  const text = current.raw_text ?? '';

  return {
    name: data.issuer_name ?? current.issuer_name ?? parsers.merchantName(text),
    city:
      data.issuer_city ??
      current.issuer_city ??
      parsers.parse(text).fields.city?.value ??
      null,
  };
}

module.exports = { applyTypedIssuer };
