import { ArrowRight } from 'lucide-react';

/**
 * Cartao de um modulo no Inicio: icone, nome, o atalho para abrir o modulo e
 * o resumo que o modulo escolher mostrar. Os widgets dividem a moldura para
 * o Inicio ler como um painel so, e nao como telas coladas.
 */
export default function Widget({ module, onOpen, children }) {
  const Icon = module.icon;
  const titleId = `widget-${module.id}`;

  return (
    <section className="widget" aria-labelledby={titleId}>
      <header className="widget__header">
        <span className="widget__icon" aria-hidden="true">
          <Icon size={16} />
        </span>
        <h3 className="widget__title" id={titleId}>
          {module.name}
        </h3>
        <button
          type="button"
          className="widget__open"
          onClick={() => onOpen()}
          aria-label={`Abrir ${module.name}`}
        >
          Abrir
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      </header>
      {children}
    </section>
  );
}

/** Um numero do resumo, com o rotulo sempre escrito. */
export function WidgetStat({ label, value }) {
  return (
    <div className="widget__stat">
      <dt className="widget__stat-label">{label}</dt>
      <dd className="widget__stat-value">{value ?? '—'}</dd>
    </div>
  );
}
