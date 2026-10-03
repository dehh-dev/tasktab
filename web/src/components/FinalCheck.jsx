/**
 * A checagem final do procedimento (issue 57), no dialogo de fechar o
 * relatorio. Informa, nao bloqueia: cada item diz em texto se confere ou o
 * que falta, e a cor da marca so reforca.
 */
export default function FinalCheck({ result }) {
  if (result.error) {
    return (
      <p className="final-check__error" role="alert">
        A checagem final nao respondeu: {result.error}
      </p>
    );
  }

  return (
    <ul className="final-check" aria-label="Checagem final">
      {result.items.map((item) => (
        <li
          key={item.check}
          className="final-check__item"
          data-ok={String(item.ok)}
        >
          <span className="final-check__status">
            {item.ok ? 'Confere' : 'Falta'}
          </span>{' '}
          <span>{item.message}</span>
        </li>
      ))}
    </ul>
  );
}
