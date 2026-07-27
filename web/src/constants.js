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
