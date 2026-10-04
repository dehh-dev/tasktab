export const ROLE_LABELS = {
  admin: 'Administrador',
  user: 'Usuario',
  auditor: 'Auditor',
};

/** "Ana Prestadora" vira "AP"; um nome so, a primeira letra. */
export function initials(name) {
  const parts = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return '?';
  }

  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return `${first}${last}`.toUpperCase();
}
