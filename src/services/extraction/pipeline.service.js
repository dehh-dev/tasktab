'use strict';

const Receipt = require('../../models/receipt.model');
const Merchant = require('../../models/merchant.model');
const cnpjRules = require('../../validators/cnpj');
const textService = require('./text.service');
const parsers = require('./parsers');
const accessKey = require('./access-key');
const qrService = require('./qr.service');
const ocrService = require('./ocr.service');

// Chave lida do QR e o dado mais confiavel que a extracao produz: o codigo tem
// correcao de erro propria e a chave ainda passa pelo DV.
const QR_CONFIDENCE = 0.99;

/**
 * Roda a extracao sobre as paginas ja criadas de um arquivo.
 *
 * Chamado pela fila, fora do ciclo de request: com OCR uma pagina custa
 * centenas de milissegundos, e 30 delas nao cabem numa resposta HTTP.
 *
 * Uma pagina que falha nao derruba as outras: o lote de 30 cupons e o caso de
 * uso, e perder o lote inteiro por causa de uma pagina seria pior que a
 * planilha manual que este projeto substitui.
 */
async function processFile({ buffer, receipts, log }) {
  let pages = [];

  try {
    pages = await textService.extractPages(buffer);
  } catch (error) {
    // Sem camada de texto legivel ainda resta o OCR: seguir com paginas vazias
    // deixa cada uma cair na rota de imagem.
    log?.warn({ err: error }, 'falha ao ler a camada de texto do PDF');
  }

  const byNumber = new Map(pages.map((page) => [page.pageNumber, page]));

  for (const receipt of receipts) {
    const page = byNumber.get(receipt.page_number);

    try {
      await Receipt.applyExtraction(receipt.id, { status: 'processing' });
      await processPage(receipt, page, { buffer, log });
    } catch (error) {
      log?.warn(
        { err: error, receipt_id: receipt.id },
        'falha ao processar pagina',
      );

      await Receipt.applyExtraction(receipt.id, {
        status: 'failed',
        raw_text: `Falha ao processar a pagina: ${error.message}`,
      }).catch(() => {});
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
  let text = page?.useful ? page.text : null;
  let source = text ? 'text' : null;
  let ocrConfidence = null;

  const key = await findAccessKey({
    buffer,
    pageNumber: receipt.page_number,
    text: text ?? '',
    log,
  });

  // Ultimo degrau da cascata: sem camada de texto, tenta ler a imagem.
  if (!text) {
    const scanned = await ocrService
      .readPage(buffer, receipt.page_number)
      .catch((error) => {
        log?.warn(
          { err: error, receipt_id: receipt.id },
          'OCR nao conseguiu ler a pagina',
        );
        return null;
      });

    if (scanned) {
      text = scanned.text;
      source = 'ocr';
      ocrConfidence = scanned.confidence;
    }
  }

  // Nem texto, nem QR, nem OCR: so uma pessoa resolve. Recibo manuscrito cai
  // aqui de proposito — o Tesseract nao le caneta, e insistir nisso e onde
  // este tipo de projeto costuma travar.
  if (!text && !key) {
    await Receipt.applyExtraction(receipt.id, { status: 'needs_review' });
    return;
  }

  const { fields } = parsers.parse(text ?? '');

  if (key) {
    fields.access_key = key;
    // O CNPJ da chave vale mais que o do texto: o cupom costuma trazer tambem
    // o da credenciadora do cartao, e a chave e verificada pelo DV.
    fields.cnpj = {
      value: key.value.slice(6, 20),
      source: key.source,
      confidence: key.confidence,
    };
  }

  const { merchant_id, category } = await classify(
    fields.cnpj?.value,
    parsers.merchantName(text ?? ''),
  );

  await Receipt.applyExtraction(receipt.id, {
    raw_text: text,
    // Nada e confirmado sozinho, e o que veio de OCR menos ainda. O ganho da
    // extracao e o humano deixar de digitar e passar a conferir.
    status: 'needs_review',
    // O QR vale mais que o texto, que vale mais que o OCR.
    extraction_source: key?.source === 'qr' ? 'qr' : (source ?? 'text'),
    issued_at: fields.issued_at?.value ?? null,
    amount_cents: fields.amount_cents?.value ?? null,
    access_key: key?.value ?? null,
    merchant_id,
    category,
    // O OCR entra no calculo como mais um campo: se ele leu mal, a linha
    // inteira merece atencao na revisao.
    confidence: lowestConfidence(
      ocrConfidence === null
        ? fields
        : { ...fields, ocr: { confidence: ocrConfidence } },
    ),
  });
}

/**
 * Vincula o comprovante ao emitente e aplica a categoria padrao dele.
 *
 * E assim que a classificacao vira automatica **sem nenhuma IA**: a ferramenta
 * aprende por cadastro. Confirmada a categoria de um cupom, todo cupom
 * seguinte daquele CNPJ ja entra classificado — no caso-base, 7 dos 28
 * lancamentos eram do mesmo emitente.
 *
 * Categoria **nunca** e adivinhada por nome ou palavra-chave. Sem CNPJ
 * conhecido o comprovante vai para revisao, e e uma pessoa que decide. Chutar
 * por nome acertaria a maioria e erraria em silencio a minoria — que e
 * exatamente o tipo de erro que so aparece na conferencia.
 */
async function classify(cnpj, name) {
  const normalized = cnpjRules.normalize(cnpj);

  if (normalized === null || !cnpjRules.isValid(normalized)) {
    return { merchant_id: null, category: null };
  }

  const merchant = await Merchant.findOrCreate({
    cnpj: normalized,
    name: name || `Emitente ${normalized}`,
  });

  if (!merchant) {
    return { merchant_id: null, category: null };
  }

  return {
    merchant_id: merchant.id,
    // `nao_classificado` e a ausencia de decisao, nao uma categoria: gravar
    // isso deixaria o comprovante parecendo classificado na listagem.
    category:
      merchant.default_category === 'nao_classificado'
        ? null
        : merchant.default_category,
  };
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
