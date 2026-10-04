import { useEffect, useState } from 'react';
import * as api from '../../api';
import { formatDate } from '../../constants';
import Widget, { WidgetStat } from '../../shell/Widget';

const SHOWN = 5;

/**
 * Prestacao de Contas no Inicio: quantos relatorios estao abertos e
 * fechados, e os abertos, cada um abrindo direto no proprio detalhe. Aberto
 * e o que ainda pede trabalho; o fechado ja foi assinado.
 */
export default function ExpensesHomeWidget({ module, onOpen }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let current = true;

    Promise.all([
      api.listReports({ status: 'open', limit: SHOWN }),
      api.listReports({ status: 'closed', limit: 1 }),
    ])
      .then(([open, closed]) => {
        if (current) {
          setSummary({
            open: open.meta.total,
            closed: closed.meta.total,
            reports: open.data,
          });
        }
      })
      .catch((caught) => {
        if (current) {
          setError(caught.message);
        }
      });

    return () => {
      current = false;
    };
  }, []);

  return (
    <Widget module={module} onOpen={onOpen}>
      {error && <p className="widget__empty">{error}</p>}
      {!error && !summary && <p className="widget__empty">Carregando...</p>}
      {summary && (
        <>
          <dl className="widget__stats">
            <WidgetStat label="Abertos" value={summary.open} />
            <WidgetStat label="Fechados" value={summary.closed} />
          </dl>

          {summary.reports.length === 0 ? (
            <p className="widget__empty">Nenhum relatorio aberto.</p>
          ) : (
            <ul className="widget__list" aria-label="Relatorios abertos">
              {summary.reports.map((report) => (
                <li key={report.id} className="widget__item">
                  <button
                    type="button"
                    className="widget__item-title link-button"
                    onClick={() => onOpen({ initialReportId: report.id })}
                  >
                    {report.title}
                  </button>
                  <span className="widget__item-meta">
                    {formatDate(report.period_start)} a{' '}
                    {formatDate(report.period_end)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Widget>
  );
}
