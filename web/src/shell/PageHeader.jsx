/**
 * Titulo e descricao de cada pagina da casca, no mesmo lugar e no mesmo tom.
 * O titulo aceita foco por script (`tabIndex={-1}`): e para onde a casca leva
 * o foco quando a navegacao tira de baixo dele o botao clicado.
 */
export default function PageHeader({ icon: Icon, title, description }) {
  return (
    <header className="page-header">
      {Icon && (
        <span className="page-header__icon" aria-hidden="true">
          <Icon size={20} />
        </span>
      )}
      <div>
        <h2 className="page-header__title" tabIndex={-1}>
          {title}
        </h2>
        {description && (
          <p className="page-header__description">{description}</p>
        )}
      </div>
    </header>
  );
}
