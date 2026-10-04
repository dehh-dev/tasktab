import { House, LogOut, Settings } from 'lucide-react';
import NavItem from './NavItem';
import { ROLE_LABELS, initials } from './session';

/**
 * Barra lateral da tela larga: a marca, o Inicio, os modulos que a sessao
 * alcanca, os Ajustes e quem esta logado. Na tela estreita quem navega e o
 * `MobileNav`, e esta nao e montada.
 */
export default function Sidebar({ user, modules, view, onNavigate, onLogout }) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="brand-mark" aria-hidden="true">
          t
        </span>
        <div>
          <h1 className="sidebar__title">tasktab</h1>
          <p className="sidebar__subtitle">Tarefas e prestacao de contas</p>
        </div>
      </div>

      <nav className="sidebar__nav" aria-label="Principal">
        <NavItem
          icon={House}
          label="Inicio"
          active={view.kind === 'home'}
          onClick={() => onNavigate({ kind: 'home' })}
        />

        <p className="sidebar__section" aria-hidden="true">
          Modulos
        </p>
        {modules.map((module) => (
          <NavItem
            key={module.id}
            icon={module.icon}
            label={module.name}
            active={view.kind === 'module' && view.moduleId === module.id}
            onClick={() => onNavigate({ kind: 'module', moduleId: module.id })}
          />
        ))}

        <div className="sidebar__spacer" />

        <NavItem
          icon={Settings}
          label="Ajustes"
          active={view.kind === 'settings'}
          onClick={() => onNavigate({ kind: 'settings' })}
        />
      </nav>

      <div className="sidebar__user">
        <span className="avatar" aria-hidden="true">
          {initials(user.name)}
        </span>
        <span className="sidebar__who">
          <span className="sidebar__name">{user.name}</span>
          {/* O papel vai escrito: "e auditor" muda o que a tela oferece. */}
          <span className="sidebar__role">{ROLE_LABELS[user.role]}</span>
        </span>
        <button
          type="button"
          className="icon-button"
          onClick={onLogout}
          aria-label="Sair"
          title="Sair"
        >
          <LogOut size={16} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
