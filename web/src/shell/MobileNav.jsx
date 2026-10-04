import { House, Settings } from 'lucide-react';
import NavItem from './NavItem';

/**
 * Menu inferior da tela estreita, ao alcance do polegar: Inicio, os modulos e
 * os Ajustes. Sai a barra lateral, que nao cabe; o "Sair" passa para a barra
 * superior.
 */
export default function MobileNav({ modules, view, onNavigate }) {
  return (
    <nav className="mobile-nav" aria-label="Principal">
      <NavItem
        compact
        icon={House}
        label="Inicio"
        active={view.kind === 'home'}
        onClick={() => onNavigate({ kind: 'home' })}
      />
      {modules.map((module) => (
        <NavItem
          compact
          key={module.id}
          icon={module.icon}
          label={module.name}
          active={view.kind === 'module' && view.moduleId === module.id}
          onClick={() => onNavigate({ kind: 'module', moduleId: module.id })}
        />
      ))}
      <NavItem
        compact
        icon={Settings}
        label="Ajustes"
        active={view.kind === 'settings'}
        onClick={() => onNavigate({ kind: 'settings' })}
      />
    </nav>
  );
}
