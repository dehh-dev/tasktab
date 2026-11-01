/** Espelha o enum task_status do banco. */
export const STATUSES = [
  { value: 'pending', label: 'Pendente' },
  { value: 'in_progress', label: 'Em andamento' },
  { value: 'done', label: 'Concluida' },
];

export const FILTER_OPTIONS = [{ value: '', label: 'Todas' }, ...STATUSES];

export function statusLabel(value) {
  return STATUSES.find((status) => status.value === value)?.label ?? value;
}

/** Formata 'YYYY-MM-DD' sem passar por Date, que desloca pela timezone. */
export function formatDate(isoDate) {
  if (!isoDate) {
    return null;
  }
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

// ---------- prestacao de contas ----------

/** Espelha o enum expense_category do banco. */
export const EXPENSE_CATEGORIES = [
  { value: 'alimentacao', label: 'Alimentacao' },
  { value: 'combustivel', label: 'Combustivel' },
  { value: 'lavanderia', label: 'Lavanderia' },
  { value: 'transporte', label: 'Taxi/Locomocao' },
  { value: 'outros', label: 'Outros' },
  { value: 'nao_classificado', label: 'Nao classificado' },
];

export function categoryLabel(value) {
  if (!value) {
    return 'Sem categoria';
  }
  return (
    EXPENSE_CATEGORIES.find((category) => category.value === value)?.label ??
    value
  );
}

/**
 * A classificacao do procedimento nos alertas da conferencia (issue 48), na
 * ordem em que a tela os agrupa. Espelha `LEVELS` do servico de conferencia.
 */
export const ALERT_LEVELS = [
  { value: 'pendente', label: 'Pendente' },
  { value: 'decisao', label: 'Decisao' },
  { value: 'atencao', label: 'Atencao' },
  { value: 'verificado', label: 'Verificado' },
  { value: 'informativo', label: 'Informativo' },
];

export function alertLevelLabel(value) {
  return ALERT_LEVELS.find((level) => level.value === value)?.label ?? value;
}

/** Espelha o enum receipt_status do banco. */
export const RECEIPT_STATUSES = {
  pending: 'Pendente',
  processing: 'Processando',
  needs_review: 'Aguardando revisao',
  confirmed: 'Confirmado',
  duplicate: 'Duplicata',
  failed: 'Falhou',
};

export function receiptStatusLabel(value) {
  return RECEIPT_STATUSES[value] ?? value;
}

/** Espelha o enum report_status do banco. */
export const REPORT_STATUSES = {
  open: 'Aberto',
  closed: 'Fechado',
};

export function reportStatusLabel(value) {
  return REPORT_STATUSES[value] ?? value;
}

/** Origem do dado extraido, para a tela de revisao indicar de onde veio. */
export const EXTRACTION_SOURCES = {
  qr: 'QR Code',
  text: 'Texto do PDF',
  ocr: 'OCR',
  manual: 'Digitado',
};

export function sourceLabel(value) {
  return EXTRACTION_SOURCES[value] ?? 'Nao extraido';
}

/** Centavos para 'R$ 1.234,56', sem depender de Intl (evita locale do SO). */
export function formatMoney(cents) {
  const value = (Math.abs(cents ?? 0) / 100).toFixed(2);
  const [reais, centavos] = value.split('.');
  const withThousands = reais.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = cents < 0 ? '-' : '';
  return `${sign}R$ ${withThousands},${centavos}`;
}

/**
 * '37,60' ou '37.60' para 3760 centavos. Devolve `null` para entrada vazia
 * ou nao numerica — nunca `NaN`, para o campo poder distinguir "sem valor"
 * de "valor invalido digitado".
 */
export function parseMoneyToCents(text) {
  const trimmed = (text ?? '').trim();
  if (trimmed === '') {
    return null;
  }
  const normalized = trimmed.replace(/\./g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/** Centavos para string de edicao em campo de texto, ex.: 3760 -> '37,60'. */
export function centsToInputValue(cents) {
  if (cents === null || cents === undefined) {
    return '';
  }
  return (cents / 100).toFixed(2).replace('.', ',');
}

// ---------- RPA de lancamentos ----------

/** Espelha o enum rpa_launch_status do banco. */
export const LAUNCH_STATUSES = { open: 'Aberto', closed: 'Encerrado' };

/** Espelha o enum rpa_payment_status. */
export const PAYMENT_STATUSES = {
  issued: 'Emitido',
  paid: 'Pago',
  canceled: 'Cancelado',
};

/** Espelha o enum rpa_payment_part: o que o RPA levou de cada dia. */
export const PAYMENT_PARTS = {
  daily: 'Diaria',
  extras: 'Extra',
  correction: 'Correcao',
};

/** Espelha o enum rpa_adjustment_kind. */
export const ADJUSTMENT_KINDS = {
  bonus: 'Bonus',
  addition: 'Acrescimo',
  deduction: 'Desconto',
};

/** Espelha o enum rpa_file_kind, sem o recibo assinado (outra tela). */
export const DOCUMENT_KINDS = {
  ctps: 'CTPS',
  id_document: 'RG ou CNH',
  address_proof: 'Comprovante de endereco',
  bank_details: 'Dados bancarios',
};

/** Espelha o enum rpa_document_side. */
export const DOCUMENT_SIDES = { front: 'Frente', back: 'Verso' };

/** Espelha o enum rpa_account_type. */
export const ACCOUNT_TYPES = {
  checking: 'Corrente',
  savings: 'Poupanca',
  payment: 'Pagamento',
};

/** Espelha o enum rpa_batch_status do envio dos recibos. */
export const BATCH_STATUSES = {
  pending: 'Na fila',
  processing: 'Lendo',
  done: 'Lido',
  failed: 'Falhou',
};

/** O tipo do dia na grade do ponto. */
export const DAY_KINDS = {
  weekday: 'Dia util',
  saturday: 'Sabado',
  sunday: 'Domingo',
  holiday: 'Feriado',
};

/** Dia da semana ISO (1 = segunda), como o horario padrao do lancamento. */
export const WEEKDAYS = [
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sab' },
  { value: 7, label: 'Dom' },
];

/** O rotulo de um enum do RPA, ou o proprio valor. */
export function labelOf(map, value) {
  return map[value] ?? value ?? '';
}

// O valor do dia vem em 1/1920 de centavo (`subcents_per_cent`).
const SUBCENTS_PER_REAL = 1920 * 100;

/**
 * Subcentavos para `R$ 154,375`: as casas que o valor tem, de 2 a 5. A grade
 * mostra a fracao de centavo de proposito — o arredondamento e so no total do
 * pagamento, e o dia exibido arredondado nao fecharia com ele.
 */
export function formatSubcents(subcents) {
  if (subcents === null || subcents === undefined) {
    return '—';
  }
  const sign = subcents < 0 ? '-' : '';
  const fixed = (Math.abs(subcents) / SUBCENTS_PER_REAL).toFixed(5);
  const [reais, decimals] = fixed.split('.');
  const trimmed = decimals.replace(/0+$/, '').padEnd(2, '0');
  const withThousands = reais.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}R$ ${withThousands},${trimmed}`;
}

/** Minutos para `9h45`. */
export function formatMinutes(total) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes === 0
    ? `${hours}h`
    : `${hours}h${String(minutes).padStart(2, '0')}`;
}
