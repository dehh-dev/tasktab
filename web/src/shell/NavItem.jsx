/**
 * Um destino da navegacao. `aria-current="page"` diz qual esta aberto — e o
 * que o leitor de tela anuncia, e o que o CSS pinta: a cor nunca e o unico
 * sinal.
 */
export default function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
  compact,
}) {
  return (
    <button
      type="button"
      className={compact ? 'nav-item nav-item--compact' : 'nav-item'}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      <span className="nav-item__icon" aria-hidden="true">
        <Icon size={compact ? 20 : 16} />
      </span>
      <span className="nav-item__label">{label}</span>
    </button>
  );
}
