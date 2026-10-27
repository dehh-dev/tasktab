'use strict';

const Receipt = require('../../models/receipt.model');
const Merchant = require('../../models/merchant.model');
const cnpjRules = require('../../validators/cnpj');
const textService = require('./text.service');
const parsers = require('./parsers');
const accessKey = require('./access-key');
const qrService = require('./qr.service');
const ocrService = require('./ocr.service');
const categoryGuess = require('./category-guess');
const dedup = require('../dedup.service');

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

      // Se nem o `failed` grava, a pagina fica em `processing` e a tela
      // consulta para sempre. Nao ha o que fazer aqui alem de deixar rastro:
      // o `reprocess` e a saida, e o log e o que aponta para ela.
      await Receipt.applyExtraction(receipt.id, {
        status: 'failed',
        raw_text: `Falha ao processar a pagina: ${error.message}`,
      }).catch((writeError) => {
        log?.error(
          { err: writeError, cause: error, receipt_id: receipt.id },
          'falha ao gravar o status failed; pagina presa em processing',
        );
      });
    }
  }
}

/**
 * Chave de acesso da pagina pelo QR. O numero vem tambem impresso
 * (`keyFromText`), mas o QR carrega correcao de erro, entao vale mais. Uma
 * chave que nao fecha o DV e descartada nos dois casos — nao ha meio termo
 * entre confiar e nao confiar num identificador com verificador.
 */
async function keyFromQr({ buffer, pageNumber, render, log }) {
  try {
    const fromQr = await qrService.readAccessKey(buffer, pageNumber, {
      png: await render(),
    });

    if (fromQr) {
      return { value: fromQr, source: 'qr', confidence: QR_CONFIDENCE };
    }
  } catch (error) {
    // QR ilegivel nao e falha: a maioria das paginas nao tem QR nenhum.
    log?.debug({ err: error, page: pageNumber }, 'nao foi possivel ler o QR');
  }

  return null;
}

/**
 * Chave impressa, lida do texto da pagina — a camada de texto do PDF ou o que
 * o OCR leu. Na foto do cupom com o QR borrado, a chave impressa e a unica, e
 * e ela que escolhe a data pelo mes (`extractDate`).
 */
function keyFromText(text, source) {
  const fromText = parsers.parse(text).fields.access_key;

  if (fromText && accessKey.isValid(fromText.value)) {
    return { ...fromText, source };
  }

  return null;
}

async function processPage(receipt, page, { buffer, log }) {
  let text = page?.useful ? page.text : null;
  let source = text ? 'text' : null;
  let ocrConfidence = null;

  // A pagina e renderizada uma vez e serve ao QR e ao OCR. Eram duas
  // renderizacoes a 3x por pagina escaneada: em Avare, 3 a 4 s cada, de uns
  // 12 s por pagina. A falha nao fica guardada: o OCR tenta de novo, como
  // quando cada um renderizava a sua.
  let rendered = null;
  const render = () => {
    rendered ??= qrService
      .renderPageToPng(buffer, receipt.page_number)
      .catch((error) => {
        rendered = null;
        throw error;
      });
    return rendered;
  };

  const fromQr = await keyFromQr({
    buffer,
    pageNumber: receipt.page_number,
    render,
    log,
  });

  // Ultimo degrau da cascata: sem camada de texto, tenta ler a imagem.
  if (!text) {
    const scanned = await render()
      .then((png) =>
        ocrService.readPage(buffer, receipt.page_number, {
          rotation: receipt.rotation,
          png,
        }),
      )
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

  // A chave impressa so e procurada depois do OCR: antes dele, a pagina
  // escaneada nao tem texto, e a chave que o OCR le nunca era usada.
  const key = fromQr ?? (text ? keyFromText(text, source) : null);

  // Nem texto, nem QR, nem OCR: so uma pessoa resolve. Recibo manuscrito cai
  // aqui de proposito — o Tesseract nao le caneta, e insistir nisso e onde
  // este tipo de projeto costuma travar.
  if (!text && !key) {
    await Receipt.applyExtraction(receipt.id, { status: 'needs_review' });
    return;
  }

  // Com a chave validada, o mes dela escolhe a data entre as que o papel traz
  // (ver `extractDate`). Ela nao inventa data: so desempata as que foram lidas.
  const { fields } = parsers.parse(text ?? '', {
    period: key ? accessKey.parse(key.value)?.issuedPeriod : null,
  });

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

  const issuerName = parsers.merchantName(text ?? '');
  const issuerCity = fields.city?.value ?? null;

  const { merchant_id, category, category_guessed } = await classify(
    fields.cnpj?.value,
    issuerName,
    issuerCity,
  );

  // So o que e provadamente o mesmo documento colapsa sozinho; suspeita vira
  // alerta na revisao, nunca exclusao silenciosa. A checagem vem antes da
  // gravacao, e nao depois dela: gravar `needs_review` primeiro deixava a
  // pagina parecendo pronta por alguns milissegundos, e quem lesse nesse
  // intervalo — a tela, que para de consultar quando nada esta em
  // processamento — via como pendente o que ia virar duplicata. Confirmada
  // ali, ela entraria na soma: o erro que a ferramenta existe para evitar.
  const original = key
    ? await dedup.findExactDuplicate({
        id: receipt.id,
        report_id: receipt.report_id,
        access_key: key.value,
      })
    : null;

  await Receipt.applyExtraction(receipt.id, {
    raw_text: text,
    // Nada e confirmado sozinho, e o que veio de OCR menos ainda. O ganho da
    // extracao e o humano deixar de digitar e passar a conferir. A duplicata
    // continua listada e vai no PDF consolidado — ela existe, so nao soma.
    status: original ? 'duplicate' : 'needs_review',
    // Nulo tambem quando reprocessada deixa de ser duplicata, para nao apontar
    // para um original que ja nao vale.
    duplicate_of_id: original?.id ?? null,
    // O QR vale mais que o texto, que vale mais que o OCR.
    extraction_source: key?.source === 'qr' ? 'qr' : (source ?? 'text'),
    issued_at: fields.issued_at?.value ?? null,
    amount_cents: fields.amount_cents?.value ?? null,
    access_key: key?.value ?? null,
    // O que o papel diz sobre quem emitiu, com ou sem CNPJ: e o que as saidas
    // usam quando o comprovante nao tem emitente cadastrado (issue 42).
    issuer_name: issuerName,
    issuer_city: issuerCity,
    merchant_id,
    category,
    category_guessed,
    // O OCR entra no calculo como mais um campo: se ele leu mal, a linha
    // inteira merece atencao na revisao.
    confidence: lowestConfidence(
      ocrConfidence === null
        ? fields
        : { ...fields, ocr: { confidence: ocrConfidence } },
    ),
  });

  if (original) {
    log?.info(
      { receipt_id: receipt.id, duplicate_of_id: original.id },
      'comprovante marcado como duplicata pela chave de acesso',
    );
  }
}

/**
 * Vincula o comprovante ao emitente e aplica a categoria padrao dele.
 *
 * E assim que a classificacao vira automatica **sem nenhuma IA**: a ferramenta
 * aprende por cadastro. Confirmada a categoria de um cupom, todo cupom
 * seguinte daquele CNPJ ja entra classificado — no caso-base, 7 dos 28
 * lancamentos eram do mesmo emitente.
 *
 * Hierarquia da categoria, da mais forte para a mais fraca:
 *
 * 1. a categoria padrao do emitente cadastrado (decidida por uma pessoa uma
 *    vez, aplicada a todo cupom seguinte daquele CNPJ);
 * 2. o palpite por palavra-chave no nome (`category-guess.js`);
 * 3. o piso `DEFAULT_CATEGORY`, quando nem o nome diz nada.
 *
 * Os degraus 2 e 3 gravam `category_guessed` e chegam destacados na revisao.
 * Depois deste ajuste **nao existe mais comprovante sem categoria**: o campo
 * vem sempre preenchido, e sempre marcado quando nao veio do cadastro.
 *
 * O palpite **nunca** sobrescreve o passo 1: cadastro e decisao registrada, e
 * um palpite nao desfaz decisao de ninguem.
 */
async function classify(cnpj, name, city) {
  // O palpite por palavra-chave e o piso `alimentacao` sao a mesma coisa para
  // quem revisa — os dois sao chute e os dois chegam marcados. Ficam separados
  // no codigo porque so o primeiro carrega evidencia: se um dia o piso mudar,
  // e `DEFAULT_CATEGORY` que muda, sem mexer nas regras que leem o nome.
  const guess =
    categoryGuess.guessCategory(name) ?? categoryGuess.DEFAULT_CATEGORY;
  const fallback = {
    merchant_id: null,
    category: guess,
    category_guessed: true,
  };

  const normalized = cnpjRules.normalize(cnpj);

  if (normalized === null || !cnpjRules.isValid(normalized)) {
    return fallback;
  }

  const merchant = await Merchant.findOrCreate({
    cnpj: normalized,
    name: name || `Emitente ${normalized}`,
    city,
  });

  if (!merchant) {
    return fallback;
  }

  // `nao_classificado` e a ausencia de decisao, nao uma categoria: gravar isso
  // deixaria o comprovante parecendo classificado na listagem.
  const registered =
    merchant.default_category === 'nao_classificado'
      ? null
      : merchant.default_category;

  return {
    merchant_id: merchant.id,
    category: registered ?? guess,
    category_guessed: registered === null,
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

module.exports = { processFile, classify };
