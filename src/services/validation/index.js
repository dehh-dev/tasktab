'use strict';

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
 * Cada alerta leva a classe do procedimento (`level`, ver `RULE_LEVEL`). Ate a
 * issue 48 eram so `erro` e `aviso`, e o que pede decisao se confundia com o
 * que provavelmente esta errado.
 */

// Amostra minima para falar em "faixa historica" de um emitente. Abaixo disso
// qualquer valor parece fora da faixa, e o alerta vira ruido.
const MIN_HISTORY = 3;

// O mesmo para o "padrao da categoria" na viagem: com menos de tres outros
// comprovantes, a mediana e de um ou dois valores, e qualquer jantar parece
// fora do padrao.
const MIN_CATEGORY_SAMPLE = 3;

// "Muito acima do padrao" e a partir de tres vezes a mediana. Na prestacao de
// Itapipoca isso marca 3 dos 35 comprovantes de alimentacao — R$ 165,00,
// R$ 173,00 e a caixa de chocolate de R$ 205,59 — e nenhum valor ficou entre
// 2,3 e 4,1 vezes a mediana.
const PATTERN_FACTOR = 3;

/**
 * A classe de cada regra, na classificacao do procedimento de prestacao de
 * contas (issue 48) — a mesma da aba de Observacoes da planilha:
 *
 * - **pendente**: falta algo para a prestacao ficar completa;
 * - **decisao**: o dado pode estar certo, e uma pessoa precisa decidir;
 * - **atencao**: o dado provavelmente foi lido ou lancado errado;
 * - **verificado**: a ferramenta conferiu e resolveu sozinha;
 * - **informativo**: nada a corrigir, so contexto para quem assina.
 *
 * Num lugar so, e nao em cada chamada: e aqui que se le a classe de tudo, e
 * uma regra nova sem classe falha no teste que percorre o mapa.
 */
const LEVELS = ['pendente', 'decisao', 'atencao', 'verificado', 'informativo'];

const RULE_LEVEL = {
  incompleto: 'pendente',
  adiantamento_nao_informado: 'pendente',
  possivel_duplicata: 'decisao',
  contingencia: 'decisao',
  categoria_outros: 'decisao',
  acima_do_padrao: 'decisao',
  periodo: 'atencao',
  chave_acesso: 'atencao',
  chave_mes: 'atencao',
  chave_uf: 'atencao',
  soma_itens: 'atencao',
  combustivel: 'atencao',
  faixa_emitente: 'atencao',
  duplicata_exata: 'verificado',
  adiantamento: 'informativo',
  valor_repetido: 'informativo',
  nao_fiscal: 'informativo',
  fora_da_cidade: 'informativo',
  duas_cidades: 'informativo',
};

function alert(rule, message, extra = {}) {
  return { rule, level: RULE_LEVEL[rule], message, ...extra };
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
        'A chave de acesso informada nao passa no digito verificador.',
        { receipt_id: receipt.id },
      ),
    );
}

/**
 * Cidade comparavel: sem acento, sem caixa e com a UF a parte, ou `null`. O
 * cupom imprime "CONCEICAO" ou "Conceição", e a cidade principal e digitada a
 * mao, com ou sem a UF.
 */
function cityOf(text) {
  const plain = (text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  if (!plain) {
    return null;
  }

  const match = /^(.+?)\s*[/-]\s*([a-z]{2})$/.exec(plain);

  return match
    ? { name: match[1], state: match[2].toUpperCase() }
    : { name: plain, state: null };
}

/** A UF de uma cidade no formato "Cidade/UF", ou `null`. */
function stateOf(city) {
  return cityOf(city)?.state ?? null;
}

/** Mesmo nome, e a mesma UF quando as duas cidades a trazem. */
function sameCity(a, b) {
  return a.name === b.name && (!a.state || !b.state || a.state === b.state);
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
          `A chave de acesso diz que o cupom e de ${parsed.issuedPeriod}, e a data lida e ${receipt.issued_at}.`,
          { receipt_id: receipt.id },
        ),
      );
    }

    if (parsed.emissionType !== '1') {
      alerts.push(
        alert(
          'contingencia',
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
        `Litros vezes preco unitario dao ${fuel} centavos, e o total do comprovante e ${receipt.amount_cents} centavos.`,
        { receipt_id: receipt.id },
      ),
    ];
  });
}

/**
 * Valor muito fora do que aquele emitente costuma cobrar. O historico vem do
 * relatorio inteiro numa consulta so (`merchantHistoryByReport`).
 */
function checkMerchantRange(receipts, history) {
  return receipts.flatMap((receipt) => {
    const range = history.get(receipt.id);

    if (receipt.amount_cents === null || !range || range.total < MIN_HISTORY) {
      return [];
    }

    // Uma ordem de grandeza fora da faixa e o sintoma de digito a mais ou a
    // menos, que e o erro que esta regra procura.
    if (
      receipt.amount_cents <= range.max_cents * 10 &&
      receipt.amount_cents * 10 >= range.min_cents
    ) {
      return [];
    }

    return [
      alert(
        'faixa_emitente',
        `Valor fora da faixa historica deste emitente (${range.min_cents} a ${range.max_cents} centavos).`,
        { receipt_id: receipt.id },
      ),
    ];
  });
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Valor muito acima do padrao da categoria na viagem (issue 51): a partir de
 * `PATTERN_FACTOR` vezes a mediana dos outros comprovantes da categoria. E
 * decisao, e nao atencao: um jantar caro pode estar certo, e quem assina
 * decide se cabe. A mediana e a dos outros, para o valor julgado nao puxar o
 * proprio padrao.
 *
 * So o confirmado, dos dois lados: a categoria do que esta em revisao e
 * palpite, com piso em alimentacao, e um combustivel ainda nao revisado
 * pareceria o almoco mais caro da viagem. Outros fica de fora — nao tem
 * padrao, e cada comprovante dela ja pede decisao.
 */
function checkCategoryPattern(receipts) {
  const confirmed = receipts.filter(
    (receipt) =>
      receipt.status === 'confirmed' &&
      receipt.amount_cents !== null &&
      receipt.category !== 'outros',
  );

  return confirmed.flatMap((receipt) => {
    const others = confirmed
      .filter(
        (other) =>
          other.id !== receipt.id && other.category === receipt.category,
      )
      .map((other) => other.amount_cents);

    if (others.length < MIN_CATEGORY_SAMPLE) {
      return [];
    }

    const pattern = median(others);

    if (receipt.amount_cents < PATTERN_FACTOR * pattern) {
      return [];
    }

    return [
      alert(
        'acima_do_padrao',
        `Valor de ${receipt.amount_cents} centavos, ${PATTERN_FACTOR} vezes ou mais a mediana desta categoria na viagem (${Math.round(pattern)} centavos): confirme se a despesa cabe na prestacao.`,
        { receipt_id: receipt.id },
      ),
    ];
  });
}

/**
 * Categoria Outros (issue 51): o procedimento manda confirmar a finalidade.
 * E onde cai o que nao tem categoria propria, e julgar se cabe na prestacao e
 * de quem assina, nao da ferramenta.
 */
function checkOtherCategory(receipts) {
  return receipts
    .filter(
      (receipt) =>
        receipt.status !== 'duplicate' && receipt.category === 'outros',
    )
    .map((receipt) =>
      alert(
        'categoria_outros',
        'Despesa em Outros: confirme a finalidade antes de assinar.',
        { receipt_id: receipt.id },
      ),
    );
}

/**
 * Despesa fora da cidade principal (issue 51). E informativo porque viagem
 * tem trecho: em Itapipoca, 9 das 41 despesas foram em Fortaleza, Goiania e
 * Salvador, nos dias de ida e volta. Sem a cidade principal ou sem a do
 * emitente nao ha o que comparar.
 */
function checkOutsideMainCity(report, receipts) {
  const main = cityOf(report.main_city);

  if (!main) {
    return [];
  }

  return receipts
    .filter((receipt) => {
      const city = cityOf(receipt.merchant_city);
      return receipt.status !== 'duplicate' && city && !sameCity(city, main);
    })
    .map((receipt) =>
      alert(
        'fora_da_cidade',
        `Despesa em ${receipt.merchant_city}, fora da cidade principal da viagem (${report.main_city}).`,
        { receipt_id: receipt.id },
      ),
    );
}

/**
 * Duas cidades no mesmo dia (issue 51): um alerta por dia, informativo,
 * porque conexao de voo explica a maioria — em Itapipoca foram 3 dos 14 dias,
 * todos de ida ou volta. Sem a hora do comprovante nao da para ir alem do dia.
 */
function checkCitiesPerDay(receipts) {
  const days = new Map();

  for (const receipt of receipts) {
    const city = cityOf(receipt.merchant_city);

    if (receipt.status === 'duplicate' || !receipt.issued_at || !city) {
      continue;
    }

    const cities = days.get(receipt.issued_at) ?? [];

    if (!cities.some((seen) => sameCity(seen.city, city))) {
      cities.push({ city, label: receipt.merchant_city });
    }

    days.set(receipt.issued_at, cities);
  }

  return [...days]
    .filter(([, cities]) => cities.length > 1)
    .map(([day, cities]) =>
      alert(
        'duas_cidades',
        `Em ${day} ha despesas em ${joinList(cities.map((seen) => seen.label))}: conexao de voo explica a maioria dos casos.`,
      ),
    );
}

/**
 * Duplicata exata consolidada sozinha: mesma chave de acesso, o mesmo
 * documento fiscal. O procedimento manda manter os dois documentos e contar o
 * valor uma vez — e dizer que fez isso, para quem assina saber por que um
 * comprovante esta fora da soma. A marcada a mao nao entra: ali quem decidiu
 * foi uma pessoa.
 */
function checkExactDuplicates(receipts) {
  return receipts
    .filter(
      (receipt) =>
        receipt.status === 'duplicate' && receipt.duplicate_of_id !== null,
    )
    .map((receipt) =>
      alert(
        'duplicata_exata',
        `Mesmo documento fiscal do comprovante ${receipt.duplicate_of_id}, pela chave de acesso: o valor conta uma vez so.`,
        { receipt_id: receipt.id, related_id: receipt.duplicate_of_id },
      ),
    );
}

/** "a", "a e b", "a, b e c". */
function joinList(items) {
  if (items.length === 1) {
    return String(items[0]);
  }

  return `${items.slice(0, -1).join(', ')} e ${items.at(-1)}`;
}

/** "do comprovante 2", "dos comprovantes 2, 3 e 4". */
function receiptList(ids) {
  return ids.length === 1
    ? `do comprovante ${ids[0]}`
    : `dos comprovantes ${joinList(ids)}`;
}

/**
 * Mesmo valor em documentos provadamente diferentes (issue 49): "avisar
 * quando houver valores repetidos que nao sao duplicata, para ninguem apagar
 * na conferencia". Foi assim que R$ 48,60 sumiram da planilha que originou o
 * projeto: dois almocos do mesmo restaurante, mesmo valor, tomados por um so.
 *
 * Provadamente e pela chave de acesso: duas chaves validas e diferentes sao
 * dois documentos fiscais, como a mesma chave e um so (`duplicata_exata`).
 * Data diferente nao basta — e lida pelo OCR, que ja trocou agosto por junho,
 * e um "nao apague" sobre duas copias do mesmo cupom seria o pior alerta
 * errado. Mesmo valor e mesma data sem chave segue como suspeita, na
 * `possivel_duplicata`.
 *
 * Um alerta por comprovante, e nao por par: a revisao mostra os alertas do
 * comprovante aberto, e quem apaga a copia aparente esta olhando para ela.
 *
 * Na tela, "apagar" tambem e marcar como duplicata, que tira da soma. A copia
 * de um documento que segue somado pode ficar assim, e nao e avisada; a
 * marcada a mao com uma chave que nenhum comprovante somado carrega continua
 * avisada — e um documento diferente fora da soma, o erro dos R$ 48,60.
 */
function checkRepeatedValues(receipts) {
  const counted = new Set(
    receipts
      .filter((receipt) => receipt.status !== 'duplicate')
      .map((receipt) => receipt.access_key),
  );
  const documents = receipts.filter(
    (receipt) =>
      receipt.amount_cents !== null &&
      accessKey.isValid(receipt.access_key) &&
      (receipt.status !== 'duplicate' || !counted.has(receipt.access_key)),
  );

  return documents.flatMap((receipt) => {
    const others = documents
      .filter(
        (other) =>
          other.amount_cents === receipt.amount_cents &&
          other.access_key !== receipt.access_key,
      )
      .map((other) => other.id);

    if (others.length === 0) {
      return [];
    }

    return [
      alert(
        'valor_repetido',
        `Mesmo valor ${receiptList(others)}, com outra chave de acesso: sao documentos diferentes, nao apague nem marque como duplicata.`,
        { receipt_id: receipt.id, related_id: others[0] },
      ),
    ];
  });
}

/**
 * Suspeitas de duplicata que exigem decisao humana. Os pares vem do
 * relatorio inteiro numa consulta so; o alerta sai no comprovante que vem
 * primeiro na lista, apontando para o outro.
 */
function checkDuplicates(receipts, pairs) {
  const partners = new Map();

  for (const { id, other_id: otherId } of pairs) {
    partners.set(id, [...(partners.get(id) ?? []), otherId]);
    partners.set(otherId, [...(partners.get(otherId) ?? []), id]);
  }

  const alerts = [];
  const seen = new Set();

  for (const receipt of receipts) {
    const others = (partners.get(receipt.id) ?? []).sort((a, b) => a - b);

    for (const otherId of others) {
      const pair = [receipt.id, otherId].sort((a, b) => a - b).join(':');

      if (seen.has(pair)) {
        continue;
      }

      seen.add(pair);
      alerts.push(
        alert(
          'possivel_duplicata',
          `Mesma data e mesmo valor do comprovante ${otherId}. Confira antes de decidir — dois almocos iguais em dias diferentes nao sao duplicata.`,
          { receipt_id: receipt.id, related_id: otherId },
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
        'Comprovante sem data, valor ou categoria — nao entra na prestacao de contas assim.',
        { receipt_id: receipt.id },
      ),
    );
}

/**
 * Adiantamento nao informado (issue 51): falta para a prestacao ficar
 * completa, porque sem ele nao ha saldo. Zero e "nao houve", e nao pede nada.
 */
function checkAdvanceInformed(report) {
  if (report.advance_cents !== null) {
    return [];
  }

  return [
    alert(
      'adiantamento_nao_informado',
      'Adiantamento nao informado: sem ele nao da para calcular o saldo da viagem.',
    ),
  ];
}

/** Soma dos comprovantes confrontada com o adiantamento recebido. */
function checkAdvance(report, totals) {
  // Sem adiantamento a comparar: zero e "nao houve", e nulo e "nao informado"
  // — este tem regra propria, e nao um alerta de excesso.
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
      `As despesas passam do adiantamento em ${difference} centavos.`,
    ),
  ];
}

/**
 * Documentos nao fiscais somados a parte (issue 50): recibo manuscrito,
 * comanda e cupom de conferencia podem ser glosados, e o procedimento manda
 * somar e informar. Sem chave de acesso valida o documento nao e NFC-e — da
 * para derivar, sem coluna nova.
 *
 * Um alerta do relatorio, com a quantidade e o total em campos proprios: um
 * por comprovante seria ruido, porque em Itapipoca eram 35 das 42 paginas.
 *
 * A base e a do total da tela: o que esta em revisao entra, a duplicata e o
 * comprovante ainda sem valor ficam de fora — o numero e uma parte do total,
 * e nao outra conta. A NFC-e cuja chave nao foi lida tambem cai aqui, ate
 * alguem digitar a chave na revisao.
 */
function checkNonFiscal(receipts) {
  const documents = receipts.filter(
    (receipt) =>
      receipt.status !== 'duplicate' &&
      receipt.amount_cents !== null &&
      !accessKey.isValid(receipt.access_key),
  );

  if (documents.length === 0) {
    return [];
  }

  const count = documents.length;
  const totalCents = documents.reduce(
    (sum, receipt) => sum + receipt.amount_cents,
    0,
  );
  const subject =
    count === 1
      ? '1 comprovante sem chave de acesso valida soma'
      : `${count} comprovantes sem chave de acesso valida somam`;

  return [
    alert(
      'nao_fiscal',
      `${subject} ${totalCents} centavos. Recibo, comanda e cupom de conferencia podem ser glosados; se for NFC-e, digite a chave na revisao.`,
      { count, total_cents: totalCents },
    ),
  ];
}

/**
 * Fora de escopo hoje, e registrado para nao parecer esquecimento:
 *
 * - **coerencia horaria** (jantar numa cidade e corrida em outra no mesmo
 *   horario) depende de ler a hora, que nenhum parser faz; a cidade e
 *   conferida so no dia (`duas_cidades`);
 * - **total declarado do relatorio** nao existe como campo: o que ha e o
 *   adiantamento, conferido acima.
 */
async function validateReport(reportId) {
  const report = await Report.findById(reportId);

  if (!report) {
    return null;
  }

  // Um numero fixo de consultas, qualquer que seja o tamanho do relatorio
  // (issue 52): nenhuma regra abaixo vai ao banco.
  const [receipts, totals, history, pairs] = await Promise.all([
    Receipt.findByReport(reportId),
    Receipt.summarizeByReport(reportId),
    Receipt.merchantHistoryByReport(reportId),
    dedup.findProbableDuplicates(reportId),
  ]);

  const alerts = [
    ...checkPeriod(report, receipts),
    ...checkAccessKeys(receipts),
    ...checkAccessKeyFields(receipts),
    ...checkItemSum(receipts),
    ...checkFuelArithmetic(receipts),
    ...checkMerchantRange(receipts, history),
    ...checkCategoryPattern(receipts),
    ...checkOtherCategory(receipts),
    ...checkOutsideMainCity(report, receipts),
    ...checkCitiesPerDay(receipts),
    ...checkExactDuplicates(receipts),
    ...checkRepeatedValues(receipts),
    ...checkDuplicates(receipts, pairs),
    ...checkIncomplete(receipts),
    ...checkAdvanceInformed(report),
    ...checkAdvance(report, totals),
    ...checkNonFiscal(receipts),
  ];

  return {
    alerts,
    meta: {
      total: alerts.length,
      ...Object.fromEntries(
        LEVELS.map((level) => [
          level,
          alerts.filter((item) => item.level === level).length,
        ]),
      ),
    },
  };
}

module.exports = { validateReport, MIN_HISTORY, LEVELS, RULE_LEVEL };
