import { LogOut } from 'lucide-react';
import { THEMES, findTheme } from './theme';

/**
 * Barra superior: onde se esta, e o tema a um clique. Na tela estreita, sem a
 * barra lateral, ela leva tambem a marca e o "Sair".
 */
export default function TopBar({
  title,
  narrow,
  theme,
  onThemeChange,
  onLogout,
}) {
  const current = findTheme(theme);
  const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
  const ThemeIcon = current.icon;

  return (
    <header className="topbar">
      {narrow ? (
        <div className="topbar__brand">
          <span className="brand-mark brand-mark--sm" aria-hidden="true">
            t
          </span>
          <h1 className="topbar__title">tasktab</h1>
        </div>
      ) : (
        <p className="topbar__crumb">
          <span className="topbar__crumb-root">tasktab</span>
          <span aria-hidden="true">/</span>
          <span className="topbar__crumb-current">{title}</span>
        </p>
      )}

      <div className="topbar__actions">
        <button
          type="button"
          className="icon-button"
          onClick={() => onThemeChange(next.value)}
          aria-label={`Tema: ${current.label}. Trocar para ${next.label}`}
          title={`Tema: ${current.label}`}
        >
          <ThemeIcon size={16} aria-hidden="true" />
        </button>
        {narrow && (
          <button
            type="button"
            className="icon-button"
            onClick={onLogout}
            aria-label="Sair"
            title="Sair"
          >
            <LogOut size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </header>
  );
}
