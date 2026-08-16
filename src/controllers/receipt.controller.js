'use strict';

const fs = require('fs/promises');
const path = require('path');

const Receipt = require('../models/receipt.model');
const Report = require('../models/report.model');
const env = require('../config/env');
const pdf = require('../services/pdf.service');
const pipeline = require('../services/extraction/pipeline.service');
const queue = require('../services/extraction/queue');
const { NotFoundError, ValidationError } = require('../../infra/errors');
const validator = require('../validators/report.validator');
const receiptValidator = require('../validators/receipt.validator');

function reportNotFound(id) {
  return new NotFoundError({
    message: `Report ${id} nao encontrado.`,
    action: 'Verifique o id informado ou liste os relatorios disponiveis.',
  });
}

function receiptNotFound(id) {
  return new NotFoundError({
    message: `Receipt ${id} nao encontrado.`,
    action: 'Verifique o id informado ou liste os comprovantes do relatorio.',
  });
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
  const report = await Report.findById(reportId);

  if (!report) {
    // O multer ja gravou os arquivos antes de sabermos que o report nao existe.
    await Promise.all((req.files || []).map((file) => discard(file.path)));
    throw reportNotFound(reportId);
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
  const report = await Report.findById(reportId);

  if (!report) {
    throw reportNotFound(reportId);
  }

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
  const receipt = await Receipt.findById(id);

  if (!receipt) {
    throw receiptNotFound(id);
  }

  res.json({ data: receipt });
}

/** PATCH /api/receipts/:id */
async function update(req, res) {
  const id = receiptValidator.validateId(req.params.id);

  // O registro atual entra na validacao: confirmar depende do conjunto final,
  // e nao so do que veio no corpo.
  const current = await Receipt.findById(id);

  if (!current) {
    throw receiptNotFound(id);
  }

  const data = receiptValidator.validateUpdate(req.body, current);
  const receipt = await Receipt.update(id, data);

  res.json({ data: receipt });
}

/** DELETE /api/receipts/:id */
async function destroy(req, res) {
  const id = receiptValidator.validateId(req.params.id);
  const deleted = await Receipt.remove(id);

  if (!deleted) {
    throw receiptNotFound(id);
  }

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
  const receipt = await Receipt.findById(id);

  if (!receipt) {
    throw receiptNotFound(id);
  }

  const filePath = path.join(env.upload.dir, receipt.file_path);
  const buffer = await fs.readFile(filePath).catch(() => null);

  if (!buffer) {
    throw new ValidationError({
      message: 'O arquivo original nao esta mais disponivel.',
      action: 'Envie o PDF novamente para reprocessar este comprovante.',
      details: [{ field: 'file_path', message: 'arquivo ausente' }],
    });
  }

  await Receipt.applyExtraction(id, { status: 'pending' });

  queue.enqueue(`reprocesso:${id}`, () =>
    pipeline.processFile({ buffer, receipts: [receipt], log: req.log }),
  );

  res.status(202).json({ data: await Receipt.findById(id) });
}

module.exports = { upload, index, show, update, destroy, reprocess };
