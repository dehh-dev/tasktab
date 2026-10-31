'use strict';

const fs = require('fs');
const multer = require('multer');
const env = require('../config/env');
const { ValidationError } = require('../../infra/errors');

fs.mkdirSync(env.upload.dir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, done) => done(null, env.upload.dir),
  // Nome temporario: o arquivo e renomeado para o proprio hash depois de lido,
  // o que faz o mesmo arquivo ocupar um lugar so no disco.
  filename: (req, file, done) =>
    done(null, `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`),
});

const upload = multer({
  storage,
  limits: { fileSize: env.upload.maxBytes, files: env.upload.maxFiles },
});

const receiveFiles = upload.array('files', env.upload.maxFiles);

/**
 * A planilha de respostas do formulario (issue 37) fica so em memoria: e
 * lida e descartada, e nao vai para o disco nem para o banco — traz CPF, RG e
 * conta de todo mundo. Um arquivo por vez, no campo `file`.
 */
const receiveSpreadsheet = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.upload.maxBytes, files: 1 },
}).single('file');

/**
 * Envolve o middleware do multer para que os erros dele saiam no formato da
 * API. Sem isso, estourar o limite de tamanho viraria um 500 generico em vez
 * de dizer ao usuario qual e o limite.
 */
function withApiErrors(receive, field, { count, unexpected }) {
  return (req, res, next) => {
    receive(req, res, (error) => {
      if (!error) {
        return next();
      }

      if (error instanceof multer.MulterError) {
        const megabytes = Math.round(env.upload.maxBytes / (1024 * 1024));

        const messages = {
          LIMIT_FILE_SIZE: `Arquivo maior que o limite de ${megabytes} MB.`,
          LIMIT_FILE_COUNT: count,
          LIMIT_UNEXPECTED_FILE: unexpected,
        };

        return next(
          new ValidationError({
            message: messages[error.code] || 'Falha ao receber o arquivo.',
            action: 'Ajuste o envio e tente de novo.',
            details: [{ field, message: error.code }],
            cause: error,
          }),
        );
      }

      return next(error);
    });
  };
}

const receiptUpload = withApiErrors(receiveFiles, 'files', {
  count: `Envie no maximo ${env.upload.maxFiles} arquivos por vez.`,
  unexpected: 'Envie os arquivos no campo "files".',
});

const spreadsheetUpload = withApiErrors(receiveSpreadsheet, 'file', {
  count: 'Envie uma planilha por vez.',
  unexpected: 'Envie a planilha no campo "file".',
});

module.exports = { receiptUpload, spreadsheetUpload };
