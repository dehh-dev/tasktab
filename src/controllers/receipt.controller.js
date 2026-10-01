'use strict';

const fs = require('fs/promises');
const path = require('path');

const Receipt = require('../models/receipt.model');
const env = require('../config/env');
const pdf = require('../services/pdf.service');
const pipeline = require('../services/extraction/pipeline.service');
const queue = require('../services/extraction/queue');
const retention = require('../services/retention.service');
const receiptImage = require('../services/receipt-image.service');
const {
  loadReport,
  loadReceipt,
  receiptNotFound,
} = require('../services/auth/access.service');
const { ValidationError } = require('../../infra/errors');
const validator = require('../validators/report.validator');
const receiptValidator = require('../validators/receipt.validator');

/**
 * Le o PDF original de um comprovante.
 *
 * So o arquivo ausente vira erro de quem usa: e o unico caso em que reenviar
 * resolve. Permissao, disco ou caminho que virou diretorio sao do servidor e
 * sobem como 500, com a causa no log — antes respondiam "envie de novo" e o
 * defeito nunca aparecia.
 */
async function readOriginal(receipt, action) {
  try {
    return await fs.readFile(path.join(env.upload.dir, receipt.file_path));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }

    throw new ValidationError({
      message: 'O arquivo original nao esta mais disponivel.',
      action,
      details: [{ field: 'file_path', message: 'arquivo ausente' }],
      cause: error,
    });
  }
}

async function discard(filePath) {
  await fs.unlink(filePath).catch(() => {});
}

/**
 * POST /api/reports/:id/receipts
 *
 * Recebe 1..N PDFs e transforma cada pagina numa linha. O trabalho de extrair
 * dados vem depois — aqui o objetivo e so nao perder nada e nao duplicar.
 */
async function upload(req, res) {
  const reportId = validator.validateId(req.params.id);

  try {
    await loadReport(req.user, reportId, { write: true });
  } catch (error) {
    // O multer ja gravou os arquivos antes de sabermos que o relatorio nao
    // existe — ou que nao e desta pessoa. Nos dois casos o que chegou ao disco
    // sai dele: um PDF orfao no volume e um documento com CNPJ de terceiros
    // que ninguem mais alcanca pela API.
    await Promise.all((req.files || []).map((file) => discard(file.path)));
    throw error;
  }

  const files = req.files || [];

  if (files.length === 0) {
    throw new ValidationError({
      message: 'Envie ao menos um arquivo PDF.',
      action: 'Anexe os arquivos no campo "files".',
      details: [{ field: 'files', message: 'nenhum arquivo recebido' }],
    });
  }

  // Primeiro passo: validar tudo antes de gravar qualquer coisa. Aceitar
  // metade do lote deixaria o usuario sem saber o que entrou.
  const received = [];

  for (const file of files) {
    const buffer = await fs.readFile(file.path);

    if (!pdf.isPdf(buffer)) {
      await Promise.all(files.map((each) => discard(each.path)));

      throw new ValidationError({
        message: `O arquivo "${file.originalname}" nao e um PDF.`,
        action: 'Envie apenas arquivos PDF.',
        details: [
          { field: 'files', message: `${file.originalname}: nao e PDF` },
        ],
      });
    }

    received.push({ file, buffer, hash: pdf.sha256(buffer) });
  }

  const created = [];
  const existing = [];

  for (const { file, buffer, hash } of received) {
    const already = await Receipt.findByReportAndHash(reportId, hash);

    if (already.length > 0) {
      // Mesmo arquivo, mesmo report: o conteudo ja esta no disco sob o hash.
      await discard(file.path);
      existing.push(...already);
      continue;
    }

    const storedName = `${hash}.pdf`;
    await fs.rename(file.path, path.join(env.upload.dir, storedName));

    let pages;
    let status;

    try {
      const total = await pdf.countPages(buffer);
      pages = Array.from({ length: total }, (unused, index) => ({
        pageNumber: index + 1,
      }));
      status = 'pending';
    } catch (error) {
      // PDF protegido ou corrompido nao pode derrubar o lote inteiro: vira uma
      // linha em `failed` com o motivo, e as outras seguem.
      req.log.warn(
        { err: error, file: file.originalname },
        'PDF ilegivel recebido',
      );
      pages = [
        { pageNumber: 1, rawText: `Falha ao ler o PDF: ${error.message}` },
      ];
      status = 'failed';
    }

    const rows = await Receipt.createPages({
      reportId,
      filePath: storedName,
      fileHash: hash,
      pages,
      status,
    });

    // Um PDF que nem abriu nao tem o que extrair. Os demais vao para a fila:
    // com OCR, processar aqui deixaria a requisicao aberta por minutos.
    if (status !== 'failed') {
      queue.enqueue(`extracao:${hash.slice(0, 8)}`, () =>
        pipeline.processFile({ buffer, receipts: rows, log: req.log }),
      );
    }

    created.push(...rows);
  }

  // 202: os registros existem, o conteudo deles ainda esta sendo lido. Quem
  // acompanha o progresso faz polling na listagem, pelo `status`.
  // Reenviar o mesmo arquivo e operacao valida e idempotente, nao um erro.
  res.status(created.length > 0 ? 202 : 200).json({
    data: created,
    meta: { created: created.length, existing: existing.length },
  });
}

/** GET /api/reports/:id/receipts */
async function index(req, res) {
  const reportId = validator.validateId(req.params.id);

  await loadReport(req.user, reportId);

  const filters = receiptValidator.validateListQuery(req.query);
  const [data, meta] = await Promise.all([
    Receipt.findByReport(reportId, filters),
    Receipt.summarizeByReport(reportId, filters),
  ]);

  res.json({ data, meta });
}

/** GET /api/receipts/:id */
async function show(req, res) {
  const id = receiptValidator.validateId(req.params.id);
  const receipt = await loadReceipt(req.user, id);

  res.json({ data: receipt });
}

/** PATCH /api/receipts/:id */
async function update(req, res) {
  const id = receiptValidator.validateId(req.params.id);

  // O registro atual entra na validacao: confirmar depende do conjunto final,
  // e nao so do que veio no corpo.
  const current = await loadReceipt(req.user, id, { write: true });

  const data = receiptValidator.validateUpdate(req.body, current);
  const receipt = await Receipt.update(id, data);

  res.json({ data: receipt });
}

/** DELETE /api/receipts/:id */
async function destroy(req, res) {
  const id = receiptValidator.validateId(req.params.id);

  await loadReceipt(req.user, id, { write: true });

  const deleted = await Receipt.remove(id);

  if (!deleted) {
    throw receiptNotFound(id);
  }

  // Apagar a linha sem apagar o PDF deixaria no disco um documento com CPF e
  // CNPJ de terceiros que ninguem mais consegue alcancar pela API.
  await retention.discardOrphans([deleted], req.log);

  res.status(204).send();
}

/**
 * POST /api/receipts/:id/reprocess
 *
 * Reenfileira uma pagina. Serve para o comprovante que ficou preso em
 * `processing` — a fila vive na memoria do processo, entao um reinicio no meio
 * do lote deixa registros nesse estado — e para tentar de novo depois de
 * ajustar o cadastro do emitente.
 */
async function reprocess(req, res) {
  const id = receiptValidator.validateId(req.params.id);
  const receipt = await loadReceipt(req.user, id, { write: true });

  const buffer = await readOriginal(
    receipt,
    'Envie o PDF novamente para reprocessar este comprovante.',
  );

  await Receipt.applyExtraction(id, { status: 'pending' });

  queue.enqueue(`reprocesso:${id}`, () =>
    pipeline.processFile({ buffer, receipts: [receipt], log: req.log }),
  );

  res.status(202).json({ data: await Receipt.findById(id) });
}

/**
 * GET /api/receipts/:id/image
 *
 * Renderiza a pagina original como WebP, para a tela de revisao mostrar o
 * cupom. Serve por endpoint proprio (mesma origem) de proposito: a CSP e
 * `img-src 'self'`, e liberar `blob:` so para isto seria afrouxar a politica
 * por conveniencia — decisao ja registrada desde a Issue 0.
 *
 * O navegador guarda a imagem, mas pergunta antes de cada uso (`no-cache`): a
 * pergunta passa pela sessao e pela posse, e como o ETag e o par (hash do
 * arquivo, pagina), que nunca muda depois de gravado, a resposta e um 304 sem
 * renderizar nada. Com `max-age` a copia era servida sem pergunta nenhuma por
 * um dia — depois do logout, e ate para outra conta no mesmo navegador.
 */
async function image(req, res) {
  const id = receiptValidator.validateId(req.params.id);
  const receipt = await loadReceipt(req.user, id);

  // Vai tambem no 304: sem isto ele herdaria o `no-store` da API, e o
  // navegador descartaria a copia — cada exibicao voltaria a renderizar.
  const cache = {
    'Cache-Control': 'private, no-cache',
    ETag: `"${receipt.file_hash}-${receipt.page_number}"`,
  };

  if (req.headers['if-none-match'] === cache.ETag) {
    return res.status(304).set(cache).end();
  }

  const buffer = await readOriginal(
    receipt,
    'Envie o PDF novamente para poder revisar este comprovante.',
  );

  // So o PDF que o pdf.js recusa e culpa do arquivo. Qualquer outra falha
  // (sharp, canvas, memoria) e do servidor, e responder "reenvie o arquivo"
  // mandaria a pessoa repetir um upload que nao resolve nada.
  const image = await receiptImage
    .render(buffer, receipt.page_number)
    .catch((error) => {
      if (error?.name !== 'InvalidPDFException') {
        throw error;
      }

      throw new ValidationError({
        message: 'Nao foi possivel gerar a imagem deste comprovante.',
        action: 'O PDF esta corrompido — reenvie o arquivo original.',
        details: [{ field: 'file_path', message: 'PDF ilegivel' }],
        cause: error,
      });
    });

  res
    .status(200)
    .set('Content-Type', image.contentType)
    .set(cache)
    .send(image.data);
}

module.exports = { upload, index, show, update, destroy, reprocess, image };
