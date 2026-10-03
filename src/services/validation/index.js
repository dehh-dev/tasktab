'use strict';

const db = require('../../config/database');
const Receipt = require('../../models/receipt.model');
const Report = require('../../models/report.model');
const accessKey = require('../extraction/access-key');
const dedup = require('../dedup.service');
const normalize = require('../extraction/normalize');

/**
 * Conferencias automaticas de um relatorio.
 *
 * Alerta **nao bloqueia nada**. Quem decide e a pessoa que assina a prestacao
 * de contas — a ferramenta aponta, nao veta. Bloquear exportacao por suspeita
 * transformaria um aviso util em obstaculo, e a saida seria contornar a
 * ferramenta.
 *
 * Severidade: `erro` para o que e comprovadamente inconsistente, `aviso` para
 * o que merece um olhar.
 */

// Amostra minima para falar em "faixa historica" de um emitente. Abaixo disso
// qualquer valor parece fora da faixa, e o alerta vira ruido.
const MIN_HISTORY = 3;

function alert(rule, severity, message, extra = {}) {
  return { rule, severity, message, ...extra };
}

/** Comprovante com data fora do periodo declarado no relatorio. */
function checkPeriod(report, receipts) {
  return receipts
    .filter(
      (receipt) =>
        receipt.issued_at &&
        (receipt.issued_at < report.period_start ||
          receipt.issued_at > report.period_end),
    )
    .map((receipt) =>
      alert(
        'periodo',
        'erro',
        `Comprovante de ${receipt.issued_at} esta fora do periodo ${report.period_start} a ${report.period_end}.`,
        { receipt_id: receipt.id },
      ),
    );
}

/**
 * Chave de acesso que nao fecha o digito verificador.
 *
 * A extracao descarta chave invalida, e a digitada na revisao e recusada no
 * `PATCH` (issue 41). Esta regra fica como rede para o que entra por fora da
 * API — seed, psql, migration.
 */
function checkAccessKeys(receipts) {
  return receipts
    .filter(
      (receipt) => receipt.access_key && !accessKey.isValid(receipt.access_key),
    )
    .map((receipt) =>
      alert(
        'chave_acesso',
        'erro',
        'A chave de acesso informada nao passa no digito verificador.',
        { receipt_id: receipt.id },
      ),
    );
}

/** A UF de uma cidade no formato "Cidade/UF", ou `null`. */
function stateOf(city) {
  const match = /\/\s*([A-Za-z]{2})\s*$/.exec(city ?? '');
  return match ? match[1].toUpperCase() : null;
}

/**
 * O que a chave de acesso ja diz e ninguem conferia (issue 47): o mes da
 * emissao, o tipo de emissao e a UF. A chave fechou o DV, entao e ela que
 * vale — quando discorda do resto, o resto foi lido errado.
 *
 * - **Mes da chave diferente da data**: o OCR leu `02/06/2026` no lugar de
 *   `02/08/2026` num cupom real, e agosto virou junho numa prestacao assinada.
 * - **Contingencia**: tipo de emissao diferente de 1 e cupom emitido sem a
 *   SEFAZ no ar, que precisa ter sido autorizado depois.
 * - **UF da chave diferente da do emitente**: a cidade lida pode estar errada,
 *   ou o emitente nao e quem parece.
 */
function checkAccessKeyFields(receipts) {
  return receipts.flatMap((receipt) => {
    const parsed = accessKey.parse(receipt.access_key);

    if (!parsed) {
      return [];
    }

    const alerts = [];

    if (
      receipt.issued_at &&
      receipt.issued_at.slice(0, 7) !== parsed.issuedPeriod
    ) {
      alerts.push(
        alert(
          'chave_mes',
          'erro',
          `A chave de acesso diz que o cupom e de ${parsed.issuedPeriod}, e a data lida e ${receipt.issued_at}.`,
          { receipt_id: receipt.id },
        ),
      );
    }

    if (parsed.emissionType !== '1') {
      alerts.push(
        alert(
          'contingencia',
          'aviso',
          `Cupom emitido em contingencia (tipo de emissao ${parsed.emissionType}): confira se foi autorizado depois.`,
          { receipt_id: receipt.id },
        ),
      );
    }

    const cityState = stateOf(receipt.merchant_city);

    if (parsed.state && cityState && parsed.state !== cityState) {
      alerts.push(
        alert(
          'chave_uf',
          'aviso',
          `A chave de acesso e de ${parsed.state}, e a cidade do emitente e de ${cityState}.`,
          { receipt_id: receipt.id },
        ),
      );
    }

    return alerts;
  });
}

/**
 * Soma dos itens diferente do total impresso.
 *
 * E a regra que pegaria o `3,60` digitado onde deveria haver `37,60`. So
 * dispara quando consegue ler ao menos dois itens: com um item so, qualquer
 * linha solta viraria alarme falso, e alarme falso destroi a confianca na
 * conferencia mais rapido do que um erro nao detectado.
 */
function checkItemSum(receipts) {
  return receipts.flatMap((receipt) => {
    if (!receipt.raw_text || receipt.amount_cents === null) {
      return [];
    }

    const items = normalize.extractItemTotals(receipt.raw_text);

    if (items.length < 2) {
      return [];
    }

    const sum = items.reduce((total, cents) => total + cents, 0);

    if (sum === receipt.amount_cents) {
      return [];
    }

    return [
      alert(
        'soma_itens',
        'erro',
        `A soma dos itens (${sum} centavos) difere do total do comprovante (${receipt.amount_cents} centavos).`,
        { receipt_id: receipt.id },
      ),
    ];
  });
}

/**
 * Combustivel: litros vezes preco unitario contra o total (issue 45).
 *
 * "E a checagem que pega erro de um digito." O OCR leu o abastecimento de
 * Itapipoca como R$ 2.225,49, e a linha do proprio cupom dizia 39,56 L x
 * R$ 5,70 = R$ 225,49. So vale a linha que fecha a propria conta: na nota de
 * Formosa o OCR sujou o preco (R$ 49,97 no lugar de 4,97), a linha nao
 * fechava, e acusar o total — que estava certo — seria alarme falso.
 *
 * So em comprovante de combustivel: num supermercado, a garrafa de 1,5 L com
 * preco e total na mesma linha passaria pelo mesmo desenho.
 */
function checkFuelArithmetic(receipts) {
  return receipts.flatMap((receipt) => {
    if (
      receipt.category !== 'combustivel' ||
      !receipt.raw_text ||
      receipt.amount_cents === null
    ) {
      return [];
    }

    const lines = normalize
      .extractFuelLines(receipt.raw_text)
      .filter((line) => line.closes);

    if (lines.length === 0) {
      return [];
    }

    const fuel = lines.reduce((sum, line) => sum + line.totalCents, 0);

    if (fuel === receipt.amount_cents) {
      return [];
    }

    return [
      alert(
        'combustivel',
        'erro',
        `Litros vezes preco unitario dao ${fuel} centavos, e o total do comprovante e ${receipt.amount_cents} centavos.`,
        { receipt_id: receipt.id },
      ),
    ];
  });
}

/** Valor muito fora do que aquele emitente costuma cobrar. */
async function checkMerchantRange(receipts) {
  const alerts = [];

  for (const receipt of receipts) {
    if (!receipt.merchant_id || receipt.amount_cents === null) {
      continue;
    }

    const { rows } = await db.query(
      `SELECT MIN(amount_cents)::int AS minimo,
              MAX(amount_cents)::int AS maximo,
              COUNT(*)::int AS total
       FROM receipts
       WHERE merchant_id = $1
         AND id <> $2
         AND amount_cents IS NOT NULL
         AND status = 'confirmed'`,
      [receipt.merchant_id, receipt.id],
    );

    const { minimo, maximo, total } = rows[0];

    if (total < MIN_HISTORY) {
      continue;
    }

    // Uma ordem de grandeza fora da faixa e o sintoma de digito a mais ou a
    // menos, que e o erro que esta regra procura.
    if (
      receipt.amount_cents > maximo * 10 ||
      receipt.amount_cents * 10 < minimo
    ) {
      alerts.push(
        alert(
          'faixa_emitente',
          'aviso',
          `Valor fora da faixa historica deste emitente (${minimo} a ${maximo} centavos).`,
          { receipt_id: receipt.id },
        ),
      );
    }
  }

  return alerts;
}

/** Suspeitas de duplicata que exigem decisao humana. */
async function checkDuplicates(receipts) {
  const alerts = [];
  const seen = new Set();

  for (const receipt of receipts) {
    if (receipt.status === 'duplicate') {
      continue;
    }

    const probable = await dedup.findProbableDuplicates(receipt);

    for (const other of probable) {
      const pair = [receipt.id, other.id].sort((a, b) => a - b).join(':');

      if (seen.has(pair)) {
        continue;
      }

      seen.add(pair);
      alerts.push(
        alert(
          'possivel_duplicata',
          'aviso',
          `Mesma data e mesmo valor do comprovante ${other.id}. Confira antes de decidir — dois almocos iguais em dias diferentes nao sao duplicata.`,
          { receipt_id: receipt.id, related_id: other.id },
        ),
      );
    }
  }

  return alerts;
}

/** Comprovantes que ainda nao dao para exportar. */
function checkIncomplete(receipts) {
  return receipts
    .filter(
      (receipt) =>
        receipt.status !== 'duplicate' &&
        (receipt.issued_at === null ||
          receipt.amount_cents === null ||
          receipt.category === null),
    )
    .map((receipt) =>
      alert(
        'incompleto',
        'aviso',
        'Comprovante sem data, valor ou categoria — nao entra na prestacao de contas assim.',
        { receipt_id: receipt.id },
      ),
    );
}

/** Soma dos comprovantes confrontada com o adiantamento recebido. */
function checkAdvance(report, totals) {
  // Sem adiantamento a comparar: zero e "nao houve", e nulo e "nao informado"
  // — este ganha regra propria na issue 51, e nao um alerta de excesso.
  if (!report.advance_cents) {
    return [];
  }

  const difference = totals.total_cents - report.advance_cents;

  if (difference <= 0) {
    return [];
  }

  return [
    alert(
      'adiantamento',
      'aviso',
      `As despesas passam do adiantamento em ${difference} centavos.`,
    ),
  ];
}

/**
 * Fora de escopo hoje, e registrado para nao parecer esquecimento:
 *
 * - **coerencia geografica e horaria** (jantar numa cidade e corrida em outra
 *   no mesmo horario) depende de extrair cidade e hora, que nenhum parser faz
 *   ainda;
 * - **total declarado do relatorio** nao existe como campo: o que ha e o
 *   adiantamento, conferido acima.
 */
async function validateReport(reportId) {
  const report = await Report.findById(reportId);

  if (!report) {
    return null;
  }

  const [receipts, totals] = await Promise.all([
    Receipt.findByReport(reportId),
    Receipt.summarizeByReport(reportId),
  ]);

  const alerts = [
    ...checkPeriod(report, receipts),
    ...checkAccessKeys(receipts),
    ...checkAccessKeyFields(receipts),
    ...checkItemSum(receipts),
    ...checkFuelArithmetic(receipts),
    ...(await checkMerchantRange(receipts)),
    ...(await checkDuplicates(receipts)),
    ...checkIncomplete(receipts),
    ...checkAdvance(report, totals),
  ];

  return {
    alerts,
    meta: {
      total: alerts.length,
      erros: alerts.filter((item) => item.severity === 'erro').length,
      avisos: alerts.filter((item) => item.severity === 'aviso').length,
    },
  };
}

module.exports = { validateReport, MIN_HISTORY };
