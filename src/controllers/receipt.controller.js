'use strict';

const fs = require('fs/promises');
const path = require('path');

const Receipt = require('../models/receipt.model');
const Report = require('../models/report.model');
const env = require('../config/env');
const pdf = require('../services/pdf.service');
const { NotFoundError, ValidationError } = require('../../infra/errors');
const validator = require('../validators/report.validator');

function reportNotFound(id) {
  return new NotFoundError({
    message: `Report ${id} nao encontrado.`,
    action: 'Verifique o id informado ou liste os relatorios disponiveis.',
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

    created.push(...rows);
  }

  // 201 so quando algo novo entrou. Reenviar o mesmo arquivo e uma operacao
  // valida e idempotente, nao um erro.
  res
    .status(created.length > 0 ? 201 : 200)
    .json({
      data: created,
      meta: { created: created.length, existing: existing.length },
    });
}

module.exports = { upload };
