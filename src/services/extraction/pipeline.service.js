'use strict';

const Receipt = require('../../models/receipt.model');
const textService = require('./text.service');

/**
 * Roda a extracao sobre as paginas ja criadas de um arquivo.
 *
 * Hoje e chamado de dentro da requisicao de upload: ler a camada de texto de
 * um PDF digital custa milissegundos. Quando o OCR entrar (M4) isso muda de
 * figura e o processamento vai para segundo plano — a issue 13 trata disso, e
 * a unidade de trabalho ja e "uma pagina, um registro", entao a mudanca e
 * local.
 *
 * Uma pagina que falha nao derruba as outras: o lote de 30 cupons e o caso de
 * uso, e perder o lote inteiro por causa de uma pagina seria pior que a
 * planilha manual que este projeto substitui.
 */
async function processFile({ buffer, receipts, log }) {
  let pages;

  try {
    pages = await textService.extractPages(buffer);
  } catch (error) {
    log?.warn({ err: error }, 'falha ao ler a camada de texto do PDF');
    return;
  }

  const byNumber = new Map(pages.map((page) => [page.pageNumber, page]));

  for (const receipt of receipts) {
    const page = byNumber.get(receipt.page_number);

    try {
      await processPage(receipt, page);
    } catch (error) {
      log?.warn(
        { err: error, receipt_id: receipt.id },
        'falha ao processar pagina',
      );
    }
  }
}

async function processPage(receipt, page) {
  // Sem camada de texto util a pagina fica para a rota de imagem (M4). O par
  // `extraction_source IS NULL` com `status = 'needs_review'` e o marcador
  // dessa fila — enquanto o OCR nao existe, quem resolve e uma pessoa.
  if (!page || !page.useful) {
    await Receipt.applyExtraction(receipt.id, { status: 'needs_review' });
    return;
  }

  await Receipt.applyExtraction(receipt.id, {
    raw_text: page.text,
    status: 'needs_review',
    extraction_source: 'text',
  });
}

module.exports = { processFile };
