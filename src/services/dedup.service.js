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
 *
 * Devolve os pares do relatorio inteiro, cada um uma vez (`id` < `other_id`),
 * numa consulta so: uma por comprovante eram 40 a cada abertura da
 * conferencia de um relatorio de 40 (issue 52).
 */
async function findProbableDuplicates(reportId) {
  const { rows } = await db.query(
    `SELECT a.id, b.id AS other_id
     FROM receipts a
     JOIN receipts b
       ON b.report_id = a.report_id
      AND b.issued_at = a.issued_at
      AND b.amount_cents = a.amount_cents
      AND b.id > a.id
      AND b.status <> 'duplicate'
      AND (
        a.access_key IS NULL
        OR b.access_key IS NULL
        OR a.access_key = b.access_key
      )
     WHERE a.report_id = $1
       AND a.status <> 'duplicate'
     ORDER BY a.id, b.id`,
    [reportId],
  );

  return rows;
}

module.exports = { findExactDuplicate, findProbableDuplicates };
