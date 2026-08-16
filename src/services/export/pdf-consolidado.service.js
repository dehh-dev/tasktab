'use strict';

const fs = require('fs/promises');
const path = require('path');
const {
  PDFDocument,
  StandardFonts,
  rgb,
  PDFName,
  PDFString,
  PDFNumber,
} = require('pdf-lib');
const env = require('../../config/env');
const { categoryLabel } = require('./labels');

// Faixa reservada no rodape para o carimbo. E uma pagina NOVA, adicionada
// abaixo do conteudo original embutido — nunca um retangulo desenhado por
// cima —, entao fisicamente nao ha como cobrir o cupom.
const STAMP_HEIGHT = 26;
const STAMP_FONT_SIZE = 7;
const STAMP_MARGIN = 8;

const INDEX_FONT_SIZE = 10;
const INDEX_LINE_HEIGHT = 16;
const INDEX_MARGIN = 40;
const INDEX_PAGE_SIZE = [595, 842]; // A4 em pontos

function formatMoney(cents) {
  return ((cents ?? 0) / 100).toFixed(2).replace('.', ',');
}

function formatDate(isoDate) {
  if (!isoDate) {
    return 'sem data';
  }
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

function truncateToWidth(text, font, size, maxWidth) {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) {
    return text;
  }

  let truncated = text;
  while (
    truncated.length > 1 &&
    font.widthOfTextAtSize(`${truncated}...`, size) > maxWidth
  ) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}...`;
}

function stampText(seq, receipt) {
  const duplicate = receipt.status === 'duplicate' ? ' [DUPLICATA]' : '';
  const merchant = receipt.merchant_name || 'Sem emitente';
  return `Item ${String(seq).padStart(2, '0')} | ${formatDate(receipt.issued_at)} | ${merchant} | R$ ${formatMoney(receipt.amount_cents)}${duplicate}`;
}

/**
 * Ordena cronologicamente, com `id` como desempate.
 *
 * O backlog pede hora do comprovante como desempate quando houver — nenhum
 * parser de extracao le hora ainda, entao esse campo nunca existe hoje.
 * Registrado como limitacao conhecida, nao como o comportamento ideal.
 */
function chronological(receipts) {
  return [...receipts].sort((a, b) => {
    const dateA = a.issued_at || '9999-99-99';
    const dateB = b.issued_at || '9999-99-99';
    if (dateA !== dateB) {
      return dateA < dateB ? -1 : 1;
    }
    return a.id - b.id;
  });
}

/** Uma ou mais paginas de indice, criadas conforme o texto cresce. */
function buildIndexPages(doc, font, boldFont, receipts) {
  const pages = [];
  let page = doc.addPage(INDEX_PAGE_SIZE);
  pages.push(page);
  let y = INDEX_PAGE_SIZE[1] - INDEX_MARGIN;

  function drawLine(text, useBold) {
    if (y < INDEX_MARGIN) {
      page = doc.addPage(INDEX_PAGE_SIZE);
      pages.push(page);
      y = INDEX_PAGE_SIZE[1] - INDEX_MARGIN;
    }
    page.drawText(text, {
      x: INDEX_MARGIN,
      y,
      size: INDEX_FONT_SIZE,
      font: useBold ? boldFont : font,
    });
    y -= INDEX_LINE_HEIGHT;
  }

  drawLine('Indice — Prestacao de Contas', true);
  y -= INDEX_LINE_HEIGHT / 2;

  receipts.forEach((receipt, index) => {
    drawLine(stampText(index + 1, receipt), false);
  });

  return pages;
}

/**
 * Registra um item de bookmark (outline) apontando para uma pagina, ligado a
 * um pai.
 *
 * pdf-lib nao tem API de alto nivel para outlines — so o `context` de baixo
 * nivel, que e o que o proprio formato PDF usa para representar dicionarios.
 */
function addOutlineItem(doc, title, targetPage, parentRef) {
  const dict = doc.context.obj({
    Title: PDFString.of(title),
    Parent: parentRef,
    Dest: doc.context.obj([targetPage.ref, PDFName.of('Fit')]),
  });
  return doc.context.register(dict);
}

function linkSiblings(doc, refs) {
  for (let i = 0; i < refs.length; i += 1) {
    const dict = doc.context.lookup(refs[i]);
    if (i > 0) {
      dict.set(PDFName.of('Prev'), refs[i - 1]);
    }
    if (i < refs.length - 1) {
      dict.set(PDFName.of('Next'), refs[i + 1]);
    }
  }
}

function buildOutlines(doc, root, branches) {
  const branchRefs = [];

  for (const branch of branches) {
    if (branch.children.length === 0) {
      continue;
    }

    const branchRef = addOutlineItem(
      doc,
      branch.title,
      branch.children[0].page,
      root,
    );
    const branchDict = doc.context.lookup(branchRef);

    const childRefs = branch.children.map((child) =>
      addOutlineItem(doc, child.title, child.page, branchRef),
    );
    linkSiblings(doc, childRefs);

    branchDict.set(PDFName.of('First'), childRefs[0]);
    branchDict.set(PDFName.of('Last'), childRefs[childRefs.length - 1]);
    branchDict.set(PDFName.of('Count'), PDFNumber.of(childRefs.length));

    branchRefs.push(branchRef);
  }

  if (branchRefs.length === 0) {
    return;
  }

  linkSiblings(doc, branchRefs);

  const rootDict = doc.context.obj({
    Type: PDFName.of('Outlines'),
    First: branchRefs[0],
    Last: branchRefs[branchRefs.length - 1],
    Count: PDFNumber.of(branchRefs.length),
  });
  doc.context.assign(root, rootDict);
  doc.catalog.set(PDFName.of('Outlines'), root);
}

/** Primeira ocorrencia de cada valor de `keyFn`, na ordem em que aparece. */
function firstOccurrencePerKey(items, keyFn, labelFn) {
  const seen = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (key !== null && !seen.has(key)) {
      seen.set(key, labelFn(item));
    }
  }
  return seen;
}

/**
 * PDF consolidado do relatorio: sumario navegavel, carimbo por pagina, ordem
 * cronologica. Junta as paginas originais dos arquivos enviados — nao gera
 * imagem nova do cupom, so embute a pagina de origem.
 */
async function buildConsolidatedPdf(report, receipts) {
  const ordered = chronological(receipts);

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const indexPages = buildIndexPages(doc, font, boldFont, ordered);

  const contentPages = [];

  for (const receipt of ordered) {
    const filePath = path.join(env.upload.dir, receipt.file_path);
    const bytes = await fs.readFile(filePath);
    const source = await PDFDocument.load(bytes);
    const [embedded] = await doc.embedPdf(source, [receipt.page_number - 1]);

    const { width, height } = embedded;
    const page = doc.addPage([width, height + STAMP_HEIGHT]);
    page.drawPage(embedded, { x: 0, y: STAMP_HEIGHT, width, height });

    const seq = contentPages.length + 1;
    const text = truncateToWidth(
      stampText(seq, receipt),
      font,
      STAMP_FONT_SIZE,
      width - STAMP_MARGIN * 2,
    );
    page.drawText(text, {
      x: STAMP_MARGIN,
      y: STAMP_MARGIN,
      size: STAMP_FONT_SIZE,
      font,
      color: rgb(0, 0, 0),
    });

    contentPages.push(page);
  }

  const byCategory = firstOccurrencePerKey(
    ordered,
    (r) => r.category,
    (r) => categoryLabel(r.category),
  );
  const byDate = firstOccurrencePerKey(
    ordered,
    (r) => r.issued_at,
    (r) => formatDate(r.issued_at),
  );

  const categoryChildren = [...byCategory.entries()].map(([key, label]) => ({
    title: label,
    page: contentPages[ordered.findIndex((r) => r.category === key)],
  }));
  const dateChildren = [...byDate.entries()].map(([key, label]) => ({
    title: label,
    page: contentPages[ordered.findIndex((r) => r.issued_at === key)],
  }));

  const root = doc.context.nextRef();
  buildOutlines(doc, root, [
    { title: 'Indice', children: [{ title: 'Indice', page: indexPages[0] }] },
    { title: 'Por categoria', children: categoryChildren },
    { title: 'Por data', children: dateChildren },
  ]);

  return {
    bytes: await doc.save(),
    pageCount: indexPages.length + contentPages.length,
    indexPageCount: indexPages.length,
    contentPageCount: contentPages.length,
  };
}

module.exports = { buildConsolidatedPdf, chronological, stampText };
