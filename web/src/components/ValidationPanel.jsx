import { ALERT_LEVELS } from '../constants';

/**
 * A conferencia do relatorio inteiro, agrupada pela classe do procedimento
 * (issue 48). Antes so apareciam os alertas de cada comprovante, na revisao
 * dele — e o do relatorio inteiro, como o de adiantamento, nao aparecia em
 * lugar nenhum da tela.
 *
 * Alerta nao bloqueia nada: o painel aponta e leva ao comprovante, quem
 * decide e quem assina.
 */
export default function ValidationPanel({ alerts, onOpen }) {
  const groups = ALERT_LEVELS.map((level) => ({
    ...level,
    items: alerts.filter((alert) => alert.level === level.value),
  })).filter((group) => group.items.length > 0);

  if (groups.length === 0) {
    return null;
  }

  return (
    <section className="validation" aria-label="Conferencia">
      <h3 className="validation__title">Conferencia</h3>

      {groups.map((group) => (
        <details
          key={group.value}
          className="validation__group alert"
          data-level={group.value}
          open
        >
          <summary className="alert__title">
            {group.label} · {group.items.length}
          </summary>
          <ul className="validation__list">
            {group.items.map((alert, index) => (
              <li
                key={`${alert.rule}:${alert.receipt_id ?? 'relatorio'}:${alert.related_id ?? ''}:${index}`}
              >
                <span>{alert.message}</span>
                {alert.receipt_id && (
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => onOpen(alert.receipt_id)}
                  >
                    Ver comprovante
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}
