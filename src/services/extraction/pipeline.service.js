'use strict';

const Receipt = require('../../models/receipt.model');
const textService = require('./text.service');
const parsers = require('./parsers');
const accessKey = require('./access-key');
const qrService = require('./qr.service');

// Chave lida do QR e o dado mais confiavel que a extracao produz: o codigo tem
// correcao de erro propria e a chave ainda passa pelo DV.
const QR_CONFIDENCE = 0.99;

/**
 * Roda a extracao sobre as paginas ja criadas de um arquivo.
 *
 * Hoje e chamado de dentro da requisicao de upload: ler a camada de texto de
 * um PDF digital custa milissegundos. Quando o OCR entrar (M4) isso muda de
 * figura e o processamento vai para segundo plano — a issue 13 trata disso, e
 * a unidade de trabalho ja e "uma pagina, um registro", entao a mudanca e
 * local.
 *
 * Uma pagina que falha nao derruba as outras: o lote de 30 cupons e o caso de
 * uso, e perder o lote inteiro por causa de uma pagina seria pior que a
 * planilha manual que este projeto substitui.
 */
async function processFile({ buffer, receipts, log }) {
  let pages;

  try {
    pages = await textService.extractPages(buffer);
  } catch (error) {
    log?.warn({ err: error }, 'falha ao ler a camada de texto do PDF');
    return;
  }

  const byNumber = new Map(pages.map((page) => [page.pageNumber, page]));

  for (const receipt of receipts) {
    const page = byNumber.get(receipt.page_number);

    try {
      await processPage(receipt, page, { buffer, log });
    } catch (error) {
      log?.warn(
        { err: error, receipt_id: receipt.id },
        'falha ao processar pagina',
      );
    }
  }
}

/**
 * Chave de acesso da pagina: QR primeiro, texto impresso como reserva.
 *
 * O numero aparece nos dois lugares, mas o QR carrega correcao de erro, entao
 * vale mais. Uma chave que nao fecha o DV e descartada nos dois casos — nao ha
 * meio termo entre confiar e nao confiar num identificador com verificador.
 */
async function findAccessKey({ buffer, pageNumber, text, log }) {
  try {
    const fromQr = await qrService.readAccessKey(buffer, pageNumber);

    if (fromQr) {
      return { value: fromQr, source: 'qr', confidence: QR_CONFIDENCE };
    }
  } catch (error) {
    // QR ilegivel nao e falha: a maioria das paginas nao tem QR nenhum.
    log?.debug({ err: error, page: pageNumber }, 'nao foi possivel ler o QR');
  }

  const fromText = parsers.parse(text).fields.access_key;

  if (fromText && accessKey.isValid(fromText.value)) {
    return fromText;
  }

  return null;
}

async function processPage(receipt, page, { buffer, log }) {
  const text = page?.useful ? page.text : null;

  const key = await findAccessKey({
    buffer,
    pageNumber: receipt.page_number,
    text: text ?? '',
    log,
  });

  // Sem camada de texto util e sem QR, a pagina fica para a rota de imagem
  // (M4). O par `extraction_source IS NULL` com `needs_review` e o marcador
  // dessa fila — enquanto o OCR nao existe, quem resolve e uma pessoa.
  if (!text && !key) {
    await Receipt.applyExtraction(receipt.id, { status: 'needs_review' });
    return;
  }

  const { fields } = parsers.parse(text ?? '');

  if (key) {
    fields.access_key = key;
  }

  await Receipt.applyExtraction(receipt.id, {
    raw_text: text,
    // Nada e confirmado sozinho. O ganho da extracao e o humano deixar de
    // digitar e passar a conferir — nao deixar de olhar.
    status: 'needs_review',
    // O QR vale mais que o texto na hora de dizer de onde veio o dado.
    extraction_source: key?.source === 'qr' ? 'qr' : 'text',
    issued_at: fields.issued_at?.value ?? null,
    amount_cents: fields.amount_cents?.value ?? null,
    access_key: key?.value ?? null,
    confidence: lowestConfidence(fields),
  });
}

/**
 * A confianca gravada e a do campo menos confiavel entre os preenchidos.
 *
 * A tela de revisao usa esse numero para destacar o que merece atencao, e um
 * documento so e tao confiavel quanto o seu pior campo — usar a media
 * esconderia justamente o campo que precisa ser olhado.
 */
function lowestConfidence(fields) {
  const values = Object.values(fields)
    .map((field) => field.confidence)
    .filter((confidence) => typeof confidence === 'number');

  return values.length > 0 ? Math.min(...values) : null;
}

module.exports = { processFile };
