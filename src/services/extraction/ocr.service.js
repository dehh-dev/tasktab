'use strict';

const env = require('../../config/env');
const { logger } = require('../../../infra/logger');
const qrService = require('./qr.service');

/**
 * OCR de paginas sem camada de texto.
 *
 * Ultimo degrau da cascata: so roda quando a triagem nao achou texto e o QR
 * nao resolveu. E o caminho mais caro e o menos confiavel — por isso nada que
 * saia daqui e confirmado sozinho.
 *
 * **Fora de escopo, por decisao consciente: manuscrito.** Os recibos escritos
 * a caneta sobre formulario nao sao lidos pelo Tesseract, e insistir nisso e
 * onde este tipo de projeto costuma travar. Vao direto para a fila manual.
 */

// Um worker so, reaproveitado: iniciar custa centenas de milissegundos, e a
// fila processa uma pagina por vez.
let workerPromise = null;

/**
 * Sobe o worker, e rejeita quando ele nao sobe.
 *
 * Sem `errorHandler`, o tesseract.js relanca o erro do worker fora de qualquer
 * promise e o processo inteiro cai: foi o que aconteceu quando o idioma nao
 * baixou, e a API saiu do ar no meio do lote. Com ele, o erro de uma leitura
 * volta pela promise do `recognize`. O da subida, nao: o `createWorker` o
 * engole e ficaria pendente para sempre, com a fila parada atras dele. Por
 * isso o `reject` sai daqui.
 */
function startWorker() {
  const { createWorker } = require('tesseract.js');

  return new Promise((resolve, reject) => {
    let started = false;

    createWorker(env.ocr.language, 1, {
      langPath: env.ocr.langPath,
      // Os dados ja estao no disco. O cache padrao gravaria mais uma copia
      // deles no diretorio de trabalho do processo.
      cacheMethod: 'none',
      logger: () => {},
      errorHandler: (error) => {
        if (!started) {
          reject(new Error(`o OCR nao subiu: ${error}`));
        }
      },
    }).then((worker) => {
      started = true;
      resolve(worker);
    }, reject);
  });
}

/**
 * O worker da fila. Se a subida falha, a falha fica guardada ate o processo
 * reiniciar: entre uma pagina e outra nada muda nos dados do idioma, e cada
 * tentativa deixaria mais uma thread parada. As paginas sem texto seguem para
 * a revisao sem leitura.
 */
function getWorker() {
  if (!workerPromise) {
    workerPromise = startWorker();
    workerPromise.catch((error) => {
      logger.error(
        { err: error },
        'o OCR nao subiu: paginas sem texto vao para a revisao sem leitura',
      );
    });
  }

  return workerPromise;
}

/** Encerra o worker. Sem isso o processo nao sai no shutdown. */
async function shutdown() {
  if (!workerPromise) {
    return;
  }

  const worker = await workerPromise.catch(() => null);
  workerPromise = null;

  await worker?.terminate().catch(() => {});
}

function withTimeout(promise, ms, onTimeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new Error(`OCR passou de ${ms}ms`));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Texto e confianca de uma pagina pelo OCR.
 *
 * A confianca vem em 0..100 do tesseract e sai daqui em 0..1, na mesma escala
 * dos demais campos — comparar 87 com 0.9 na tela de revisao nao ajudaria
 * ninguem.
 *
 * `rotation` e o giro escolhido na revisao (issue 43): o Tesseract nao
 * endireita a pagina sozinho, e um cupom de cabeca para baixo sai como ruido.
 * O QR nao precisa disso — o zxing acha o codigo em qualquer orientacao.
 */
async function readPage(buffer, pageNumber, { rotation = 0 } = {}) {
  if (!env.ocr.enabled) {
    return null;
  }

  const png = await qrService.renderPageToPng(buffer, pageNumber);

  // Cinza e normalizacao: e no pre-processamento que o OCR ganha ou perde.
  const sharp = require('sharp');
  const prepared = await sharp(png)
    .rotate(rotation)
    .greyscale()
    .normalise()
    .toBuffer();

  const worker = await getWorker();

  const { data } = await withTimeout(
    worker.recognize(prepared),
    env.ocr.timeoutMs,
    () => {
      // Um worker que estourou o teto fica num estado que nao da para
      // reaproveitar: derruba e o proximo uso cria outro.
      logger.warn({ page: pageNumber }, 'OCR estourou o teto de tempo');
      shutdown();
    },
  );

  const text = String(data.text || '').trim();

  if (text === '') {
    return null;
  }

  return { text, confidence: Math.max(0, Math.min(1, data.confidence / 100)) };
}

module.exports = { readPage, shutdown };
