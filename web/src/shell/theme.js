import { Monitor, Moon, Sun } from 'lucide-react';

/**
 * Tema da tela. `system` segue o sistema; `light` e `dark` valem contra ele.
 *
 * A escolha fica no navegador e vira `data-theme` no <html>, que o styles.css
 * ja le. O do sistema nao leva atributo nenhum: a media query do CSS resolve
 * sozinha, sem esperar o JavaScript, e quem usa tema escuro nao ve o clarao
 * branco a cada carga. A escolha explicita e aplicada na carga por
 * `public/tema.js`, antes do React — mudou a chave ou os valores, mude la.
 */
const STORAGE_KEY = 'tasktab:tema';

export const THEMES = [
  { value: 'system', label: 'Sistema', icon: Monitor },
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Escuro', icon: Moon },
];

export function findTheme(value) {
  return THEMES.find((theme) => theme.value === value) ?? THEMES[0];
}

/** O tema guardado, ou o do sistema. Sem storage (aba anonima), o do sistema. */
export function readTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return THEMES.some((theme) => theme.value === saved) ? saved : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme) {
  const root = document.documentElement;

  if (theme === 'system') {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }
}

export function saveTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Sem storage a escolha vale so ate a aba fechar, e a tela segue igual.
  }

  applyTheme(theme);
}
