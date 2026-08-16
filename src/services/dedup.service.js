'use strict';

const db = require('../config/database');

/**
 * Deteccao de comprovantes repetidos.
 *
 * O risco aqui e assimetrico. Deixar passar uma duplicata infla o total, e a
 * conferencia pega. **Marcar como duplicata o que nao e some com uma despesa
 * legitima** — foi assim que R$ 48,60 desapareceram da planilha oficial que
 * originou este projeto, quando dois almocos do mesmo restaurante, com o mesmo
 * valor e dias diferentes, foram tomados por lancamento repetido.
 *
 * Dai a divisao: so o que e **provadamente** o mesmo documento colapsa
 * sozinho. O resto vira alerta para uma pessoa decidir.
 */

/**
 * Mesma chave de acesso e o mesmo documento fiscal, sem ambiguidade: a chave
 * carrega numero da nota, serie e emitente, e passou pelo digito verificador.
 */
async function findExactDuplicate(receipt) {
  if (!receipt.access_key) {
    return null;
  }

  const { rows } = await db.query(
    `SELECT id FROM receipts
     WHERE report_id = $1
       AND access_key = $2
       AND id <> $3
       AND status <> 'duplicate'
     ORDER BY id
     LIMIT 1`,
    [receipt.report_id, receipt.access_key, receipt.id],
  );

  return rows[0] || null;
}

/**
 * Mesma data e mesmo valor: **suspeita**, nunca certeza.
 *
 * Casos reais que caem aqui: cupom mais comprovante de cartao, comanda mais
 * cupom fiscal, recibo proprio mais recibo do aplicativo de entrega.
 *
 * Duas notas com chave de acesso diferente sao documentos diferentes por
 * definicao, entao nem entram na lista — e o que impede a suspeita de virar
 * ruido em restaurante que cobra sempre o mesmo preco.
 */
async function findProbableDuplicates(receipt) {
  if (!receipt.issued_at || receipt.amount_cents === null) {
    return [];
  }

  const { rows } = await db.query(
    `SELECT id, access_key FROM receipts
     WHERE report_id = $1
       AND issued_at = $2
       AND amount_cents = $3
       AND id <> $4
       AND status <> 'duplicate'
       AND (
         access_key IS NULL
         OR $5::varchar IS NULL
         OR access_key = $5
       )
     ORDER BY id`,
    [
      receipt.report_id,
      receipt.issued_at,
      receipt.amount_cents,
      receipt.id,
      receipt.access_key,
    ],
  );

  return rows;
}

/**
 * Marca o comprovante como duplicata quando ha certeza documental.
 *
 * Devolve o id do original, ou `null` se nada foi marcado. A linha marcada
 * continua listada e vai no PDF consolidado — ela existe, so nao soma.
 */
async function collapseExact(receipt) {
  const original = await findExactDuplicate(receipt);

  if (!original) {
    return null;
  }

  await db.query(
    `UPDATE receipts SET status = 'duplicate', duplicate_of_id = $1
     WHERE id = $2`,
    [original.id, receipt.id],
  );

  return original.id;
}

module.exports = { findExactDuplicate, findProbableDuplicates, collapseExact };
