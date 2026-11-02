'use strict';

const fsp = require('fs/promises');
const path = require('path');
const JSZip = require('jszip');
const { PDFDocument } = require('pdf-lib');
const env = require('../../config/env');
const Payment = require('../../models/rpa-payment.model');
const RpaFile = require('../../models/rpa-file.model');
const Batch = require('../../models/rpa-receipt-batch.model');
const queue = require('../extraction/queue');
const ocr = require('../extraction/ocr.service');
const { extractPages } = require('../extraction/text.service');
const { isPdf, sha256, countPages } = require('../pdf.service');
const { ValidationError } = require('../../../infra/errors');
const { logger } = require('../../../infra/logger');
const {
  readName,
  readNetCents,
  readDate,
  matchPage,
  sameName,
} = require('./receipt-reading');

/**
 * Os recibos assinados (issue 42). O financeiro devolve um PDF escaneado so,
 * uma pagina por pessoa; aqui cada pagina vai para a pessoa certa, sai num
 * PDF proprio com o nome do cadastro e o pagamento vira pago.
 *
 * A leitura (texto e, sem texto, OCR) roda na fila, fora da requisicao, como
 * o reprocessamento do comprovante. Nada aqui loga CPF, nome ou valor: so ids
 * e contagens.
 */

function invalidFile(message) {
  return new ValidationError({
    message,
    action: 'Envie o PDF escaneado dos recibos, como o financeiro devolveu.',
    details: [{ field: 'file', message }],
  });
}

/** Grava pelo hash; o mesmo arquivo ja no disco fica como esta. */
async function store(hash, data) {
  const filePath = `${hash}.pdf`;
  await fsp
    .writeFile(path.join(env.upload.dir, filePath), data, { flag: 'wx' })
    .catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
  return filePath;
}

/** Cada arquivo conferido; o erro diz qual pela ordem, nunca pelo nome. */
async function readSources(buffers) {
  const sources = [];
  let firstPage = 1;

  for (const [index, buffer] of buffers.entries()) {
    const which = buffers.length > 1 ? `o ${index + 1}º arquivo` : 'o arquivo';
    if (!isPdf(buffer)) throw invalidFile(`${which} nao e um PDF`);

    let pageCount;
    try {
      pageCount = await countPages(buffer);
    } catch {
      throw invalidFile(`${which} nao abre como PDF`);
    }

    sources.push({ buffer, first_page: firstPage, page_count: pageCount });
    firstPage += pageCount;
  }

  return sources;
}

/** Os PDFs enviados juntos, na ordem, num so: e o que a leitura percorre. */
async function joined(sources) {
  if (sources.length === 1) return sources[0].buffer;

  const document = await PDFDocument.create({ updateMetadata: false });
  for (const { buffer } of sources) {
    const source = await PDFDocument.load(buffer, { updateMetadata: false });
    const pages = await document.copyPages(source, source.getPageIndices());
    for (const page of pages) document.addPage(page);
  }
  return Buffer.from(await document.save());
}

/**
 * Recebe os PDFs (o escaneado com todos, ou um por pessoa), confere que sao
 * PDF e que o pagamento existe, e enfileira a leitura. Devolve o envio
 * `pending`: a tela acompanha pelo id.
 */
async function startReceipts({ launch, number, buffers, createdBy, log }) {
  const sources = await readSources(buffers);
  const pageCount = sources.reduce((total, src) => total + src.page_count, 0);

  const payments = await Payment.findDocumentsByNumber(launch.id, number);
  if (payments.length === 0) {
    throw new ValidationError({
      message: `O lancamento nao tem RPA valido do ${number}º pagamento.`,
      action: 'Confira o numero do pagamento dos recibos.',
      details: [{ field: 'payment', message: 'nenhum RPA com este numero' }],
    });
  }

  const stored = [];
  for (const { buffer, ...pages } of sources) {
    const hash = sha256(buffer);
    stored.push({
      file_hash: hash,
      file_path: await store(hash, buffer),
      byte_size: buffer.length,
      ...pages,
    });
  }

  const read = await joined(sources);
  const hash = sha256(read);
  const batch = await Batch.create({
    launch_id: launch.id,
    payment_number: number,
    file_hash: hash,
    file_path: await store(hash, read),
    page_count: pageCount,
    sources: stored,
    created_by: createdBy,
  });

  queue.enqueue(`rpa-recibos:${batch.id}`, () => processBatch(batch.id, log));
  return batch;
}

/** O texto de cada pagina: a camada de texto, ou o OCR quando ela nao serve. */
async function pageTexts(buffer) {
  const pages = await extractPages(buffer);
  const texts = [];

  for (const page of pages) {
    if (page.useful) {
      texts.push(page.text);
      continue;
    }

    // Sem normalizar: a linha de assinatura do recibo, normalizada, faz o
    // Tesseract perder a pagina (ver `ocr.service.js`).
    const read = await ocr
      .readPage(buffer, page.pageNumber, { normalise: false })
      .catch(() => null);
    texts.push(read?.text ?? '');
  }

  return texts;
}

/** A pagina copiada como esta (sem recomprimir), num PDF so dela. */
async function singlePage(source, index) {
  // Sem `updateMetadata`, o PDF nao leva data: a mesma pagina da sempre o
  // mesmo arquivo, e reenviar o lote nao duplica o recibo.
  const document = await PDFDocument.create({ updateMetadata: false });
  const [page] = await document.copyPages(source, [index]);
  document.addPage(page);
  return Buffer.from(await document.save());
}

function summary(payment) {
  return {
    worker_id: payment.worker.id,
    worker_number: payment.worker.number,
    worker_name: payment.worker.name,
    payment_id: payment.id,
    code: payment.code,
  };
}

/**
 * Confere as paginas contra os RPAs do pagamento. Cada pessoa pega a
 * primeira pagina dela; a segunda vai para as sem pessoa, como repetida.
 * Nome e valor diferentes sao apontados, nunca corrigidos.
 */
function analyze(texts, payments) {
  const candidates = payments.map((payment) => ({
    payment,
    worker: payment.worker,
  }));
  const taken = new Map();
  const result = {
    matched: [],
    missing: [],
    unmatched_pages: [],
    name_differences: [],
    value_differences: [],
    date_differences: [],
  };

  texts.forEach((text, index) => {
    const page = index + 1;
    const match = matchPage(text, candidates);

    if (!match.candidate) {
      result.unmatched_pages.push({
        page,
        reason:
          match.cpfs.length > 0
            ? 'CPF de quem nao esta neste pagamento'
            : 'sem CPF nem nome legivel',
      });
      return;
    }

    const { payment } = match.candidate;
    if (taken.has(payment.id)) {
      result.unmatched_pages.push({
        page,
        reason: `repetida: a pessoa ja esta na pagina ${taken.get(payment.id)}`,
      });
      return;
    }
    taken.set(payment.id, page);

    const nameRead = readName(text);
    const netRead = readNetCents(text);
    const dateRead = readDate(text);

    result.matched.push({
      page,
      by: match.by,
      ...summary(payment),
      name_read: nameRead,
      net_read_cents: netRead,
      date_read: dateRead,
    });

    if (nameRead && !sameName(nameRead, payment.worker.name)) {
      result.name_differences.push({
        page,
        ...summary(payment),
        name_read: nameRead,
      });
    }
    if (netRead !== null && netRead !== payment.net_cents) {
      result.value_differences.push({
        page,
        ...summary(payment),
        net_read_cents: netRead,
        net_cents: payment.net_cents,
      });
    }
    if (dateRead && dateRead !== payment.payment_date) {
      result.date_differences.push({
        page,
        ...summary(payment),
        date_read: dateRead,
        payment_date: payment.payment_date,
      });
    }
  });

  for (const payment of payments) {
    if (!taken.has(payment.id)) result.missing.push(summary(payment));
  }

  return result;
}

/** Os arquivos do envio; o anterior a `sources` e o proprio PDF lido. */
function sourcesOf(batch, buffer) {
  if (batch.sources.length > 0) return batch.sources;

  return [
    {
      file_hash: batch.file_hash,
      file_path: batch.file_path,
      byte_size: buffer.length,
      first_page: 1,
      page_count: batch.page_count,
    },
  ];
}

/**
 * A leitura de um envio, na fila. Falha vira `failed` com mensagem publica;
 * o erro de verdade vai para o log so com o id do envio.
 */
async function processBatch(id, log = logger) {
  const batch = await Batch.start(id);
  if (!batch) return;

  try {
    const buffer = await fsp.readFile(
      path.join(env.upload.dir, batch.file_path),
    );
    const payments = await Payment.findDocumentsByNumber(
      batch.launch_id,
      batch.payment_number,
    );
    const texts = await pageTexts(buffer);
    const result = analyze(texts, payments);
    const source = await PDFDocument.load(buffer, { updateMetadata: false });
    const files = sourcesOf(batch, buffer);
    const receipts = [];

    for (const entry of result.matched) {
      const from = files.find(
        (file) =>
          entry.page >= file.first_page &&
          entry.page < file.first_page + file.page_count,
      );
      // Arquivo de uma pagina so vai como veio: e o recibo inteiro da pessoa,
      // e uma copia da pagina perderia a assinatura digital dele.
      if (from?.page_count === 1) {
        receipts.push({
          worker_id: entry.worker_id,
          payment_id: entry.payment_id,
          file_hash: from.file_hash,
          file_path: from.file_path,
          byte_size: from.byte_size,
        });
        continue;
      }

      const data = await singlePage(source, entry.page - 1);
      const hash = sha256(data);
      receipts.push({
        worker_id: entry.worker_id,
        payment_id: entry.payment_id,
        file_hash: hash,
        file_path: await store(hash, data),
        byte_size: data.length,
      });
    }

    await RpaFile.insertReceipts(batch.launch_id, receipts);
    await Payment.markPaid(receipts.map((receipt) => receipt.payment_id));
    await Batch.finish(id, { pages: texts.length, ...result });

    log.info(
      {
        batch_id: id,
        matched: result.matched.length,
        missing: result.missing.length,
        unmatched: result.unmatched_pages.length,
      },
      'recibos lidos',
    );
  } catch (error) {
    log.error({ err: error, batch_id: id }, 'leitura dos recibos falhou');
    await Batch.fail(id, 'Nao foi possivel ler o PDF dos recibos.');
  }
}

/** `RECIBO NOME COMPLETO.pdf`, com o nome do cadastro, um por pessoa. */
async function receiptsZip(launch, number) {
  const receipts = await RpaFile.findReceipts(launch.id, number);

  if (receipts.length === 0) {
    throw new ValidationError({
      message: `Nenhum recibo assinado do ${number}º pagamento.`,
      action: 'Envie o PDF dos recibos e espere a leitura terminar.',
      details: [{ field: 'payment', message: 'nenhum recibo com este numero' }],
    });
  }

  const zip = new JSZip();
  const used = new Set();

  for (const receipt of receipts) {
    let name = `RECIBO ${receipt.worker_name.toUpperCase()}.pdf`;
    if (used.has(name))
      name = name.replace(/\.pdf$/, ` (${receipt.worker_number}).pdf`);
    used.add(name);

    zip.file(
      name,
      await fsp.readFile(path.join(env.upload.dir, receipt.file_path)),
    );
  }

  return {
    fileName: `Recibos - ${number}ª Pagto - ${launch.city}-${launch.state}.zip`,
    buffer: await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'STORE',
    }),
  };
}

module.exports = { startReceipts, processBatch, analyze, receiptsZip };
