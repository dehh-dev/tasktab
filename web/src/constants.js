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
  { value: 'estacionamento', label: 'Estacionamento' },
  { value: 'lavanderia', label: 'Lavanderia' },
  { value: 'transporte', label: 'Transporte' },
  { value: 'hospedagem', label: 'Hospedagem' },
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
