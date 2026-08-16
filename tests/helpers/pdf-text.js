'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.resolve(__dirname, 'extract-pdf-text.script.js');

/** Texto de cada pagina de um PDF (array), extraido em subprocesso. */
function extractPdfText(buffer) {
  const tmpFile = path.join(
    os.tmpdir(),
    `pdf-text-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`,
  );
  fs.writeFileSync(tmpFile, buffer);

  try {
    const output = execFileSync('node', [SCRIPT, tmpFile], {
      encoding: 'utf8',
    });
    return JSON.parse(output);
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

module.exports = { extractPdfText };
