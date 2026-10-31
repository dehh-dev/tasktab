'use strict';

const fs = require('fs/promises');
const RpaFile = require('../models/rpa-file.model');
const Worker = require('../models/rpa-worker.model');
const { loadLaunch, loadRpaFile } = require('../services/auth/access.service');
const {
  importDocuments,
  documentsZip,
} = require('../services/rpa/documents.service');
const { contentDisposition } = require('../services/rpa/rpa-format');
const { ValidationError } = require('../../infra/errors');
const launchValidator = require('../validators/rpa-launch.validator');
const validator = require('../validators/rpa-file.validator');

/**
 * POST /api/rpa/launches/:id/documents — o .zip da pasta de respostas do
 * Drive, no campo `file`. O arquivo temporario sai do disco em qualquer caso.
 */
async function upload(req, res) {
  const id = launchValidator.validateId(req.params.id);

  try {
    const launch = await loadLaunch(id, { write: true });

    if (!req.file) {
      throw new ValidationError({
        message: 'Envie o .zip da pasta de respostas do formulario.',
        action:
          'No Drive, use "Fazer download" na pasta de respostas e envie o .zip no campo "file".',
        details: [{ field: 'file', message: 'arquivo obrigatorio' }],
      });
    }

    const result = await importDocuments(launch, req.file.path, req.log);

    // So contagens: nome de arquivo e nome de conta sao de terceiros.
    req.log.info(
      {
        launch_id: id,
        stored: result.stored,
        created: result.created,
        rejected: result.rejected.length,
      },
      'documentos importados',
    );

    res.json({ data: result });
  } finally {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
  }
}

/** GET /api/rpa/launches/:id/documents */
async function index(req, res) {
  const id = launchValidator.validateId(req.params.id);

  await loadLaunch(id);

  res.json({ data: await RpaFile.findDocuments(id) });
}

/** GET /api/rpa/launches/:id/documents.zip?email=true */
async function zip(req, res) {
  const id = launchValidator.validateId(req.params.id);
  const launch = await loadLaunch(id);
  const { email } = validator.validateZipQuery(req.query);
  const result = await documentsZip(launch, { email });

  res
    .set('Content-Type', 'application/zip')
    .set('Content-Disposition', contentDisposition(result.fileName));

  if (result.stream) {
    result.stream.pipe(res);
    return;
  }

  // O aviso vai num cabecalho: o corpo e o .zip. Texto sem acento, como o
  // resto da API — cabecalho HTTP nao leva UTF-8.
  if (result.warnings.length > 0) {
    res.set('X-Email-Warning', result.warnings.join(' '));
  }
  res.send(result.buffer);
}

/** PATCH /api/rpa/files/:id — a pessoa, o tipo ou o lado, escolhidos na mao. */
async function update(req, res) {
  const id = validator.validateId(req.params.id);
  const data = validator.validateUpdate(req.body);
  const { file } = await loadRpaFile(id, { write: true });

  if (data.worker_id) {
    const worker = await Worker.findById(data.worker_id);

    if (!worker || worker.launch_id !== file.launch_id) {
      throw new ValidationError({
        details: [
          { field: 'worker_id', message: 'a pessoa nao e deste lancamento' },
        ],
      });
    }
  }

  res.json({ data: await RpaFile.update(id, data) });
}

module.exports = { upload, index, zip, update };
