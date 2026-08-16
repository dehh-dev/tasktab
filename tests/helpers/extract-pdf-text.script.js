'use strict';

/**
 * Roda em processo Node puro, fora da VM do Jest — e o unico jeito de usar o
 * `unpdf` aqui: ele carrega o pdf.js por import dinamico, que a VM do Jest
 * recusa sem `--experimental-vm-modules` (o mesmo problema que
 * `text.service.js` tem, e pelo mesmo motivo essa extracao so e testada por
 * integracao, nunca chamando o servico direto de dentro de um teste).
 *
 * Chamado por `tests/helpers/pdf-text.js` via subprocesso, no mesmo espirito
 * do `runPendingMigrations()` do orchestrator, que tambem sai da VM do Jest
 * para rodar `node-pg-migrate`.
 */
const fs = require('fs');
const { extractText, getDocumentProxy } = require('unpdf');

async function main() {
  const [, , filePath] = process.argv;
  const buffer = fs.readFileSync(filePath);
  const doc = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(doc, { mergePages: false });
  process.stdout.write(JSON.stringify(text));
}

main().catch((error) => {
  process.stderr.write(String(error.stack || error.message));
  process.exitCode = 1;
});
