'use strict';

const fs = require('fs/promises');
const path = require('path');
const JSZip = require('jszip');
const { PDFDocument, degrees } = require('pdf-lib');
const env = require('../../config/env');
const { CATEGORY_LABELS, categoryKey, categoryLabel } = require('./labels');
const { chronological, pageRotation } = require('./pdf-consolidado.service');

// A ordem dos arquivos e a das abas da planilha: a do enum, com "Sem
// categoria" no fim.
const CATEGORY_ORDER = [...Object.keys(CATEGORY_LABELS), null];

/** "Táxi/Locomoção" vira "taxi-locomocao": nome de arquivo sem acento nem barra. */
function slug(label) {
  return label
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Os PDFs do relatorio por categoria, num ZIP (issue 54): a entrega do
 * procedimento, um arquivo por categoria com despesa, em ordem cronologica,
 * com as paginas originais — "nunca rasterizar, nunca recortar".
 *
 * A pagina e **copiada**, nao embutida como no consolidado: sai com o
 * conteudo, o tamanho e o `/Rotate` da origem, sem faixa de carimbo. O giro
 * escolhido na revisao (issue 43) soma ao `/Rotate`, que e atributo da
 * pagina — o conteudo nao muda.
 *
 * Toda pagina do relatorio vai para exatamente um arquivo. A duplicata vai
 * junto, como comprovacao, e a pagina sem categoria vai para "Sem categoria".
 * A numeracao dos arquivos e corrida, para ninguem procurar um arquivo que
 * faltou entre o 01 e o 03.
 *
 * Devolve cada arquivo com os comprovantes que levou e as paginas que saiu:
 * e o que a checagem final (issue 57) confere contra o que foi recebido.
 */
async function buildCategoryPdfs(receipts) {
  const sources = new Map();
  const files = [];

  // Cada arquivo enviado e lido uma vez, por mais paginas que tenha.
  function load(filePath) {
    if (!sources.has(filePath)) {
      sources.set(
        filePath,
        fs
          .readFile(path.join(env.upload.dir, filePath))
          .then((bytes) => PDFDocument.load(bytes)),
      );
    }

    return sources.get(filePath);
  }

  const groups = CATEGORY_ORDER.map((key) => ({
    label: categoryLabel(key),
    receipts: chronological(
      receipts.filter((receipt) => categoryKey(receipt.category) === key),
    ),
  })).filter((group) => group.receipts.length > 0);

  for (const [index, group] of groups.entries()) {
    const doc = await PDFDocument.create();
    const pages = new Map();

    // As paginas de um mesmo arquivo saem numa copia so, e dividem fonte e
    // imagem em vez de repeti-las a cada pagina.
    for (const filePath of new Set(group.receipts.map((r) => r.file_path))) {
      const items = group.receipts.filter((r) => r.file_path === filePath);
      const copied = await doc.copyPages(
        await load(filePath),
        items.map((receipt) => receipt.page_number - 1),
      );

      items.forEach((receipt, position) => {
        pages.set(receipt.id, copied[position]);
      });
    }

    for (const receipt of group.receipts) {
      const page = pages.get(receipt.id);

      if (receipt.rotation) {
        page.setRotation(
          degrees((pageRotation(page) + receipt.rotation) % 360),
        );
      }

      doc.addPage(page);
    }

    files.push({
      name: `${String(index + 1).padStart(2, '0')}_${slug(group.label)}.pdf`,
      receiptIds: group.receipts.map((receipt) => receipt.id),
      pageCount: doc.getPageCount(),
      bytes: await doc.save(),
    });
  }

  return files;
}

/** Os PDFs por categoria num ZIP, um arquivo por categoria com despesa. */
async function buildCategoryZip(receipts) {
  const zip = new JSZip();

  for (const file of await buildCategoryPdfs(receipts)) {
    zip.file(file.name, file.bytes);
  }

  return zip.generateAsync({ type: 'nodebuffer' });
}

module.exports = { buildCategoryPdfs, buildCategoryZip };
