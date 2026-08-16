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

async function getWorker() {
  if (!workerPromise) {
    const { createWorker } = require('tesseract.js');

    workerPromise = createWorker(env.ocr.language, 1, {
      cachePath: env.ocr.cachePath,
      logger: () => {},
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
 * Texto e confianca de uma pagina.
 *
 * A confianca vem em 0..100 do tesseract e sai daqui em 0..1, na mesma escala
 * dos demais campos — comparar 87 com 0.9 na tela de revisao nao ajudaria
 * ninguem.
 */
async function readPage(buffer, pageNumber) {
  if (!env.ocr.enabled) {
    return null;
  }

  const png = await qrService.renderPageToPng(buffer, pageNumber);

  // Cinza e normalizacao: e no pre-processamento que o OCR ganha ou perde.
  const sharp = require('sharp');
  const prepared = await sharp(png).greyscale().normalise().toBuffer();

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
