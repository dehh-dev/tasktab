import { use } from 'react';
import * as api from '../../api';
import { formatDate } from '../../constants';
import Widget, { WidgetStat } from '../../shell/Widget';

const SHOWN = 5;

/**
 * O resumo da Prestacao de Contas no Inicio: quantos relatorios estao abertos
 * e fechados, e os abertos. Aberto e o que ainda pede trabalho; o fechado ja
 * foi assinado.
 */
export async function loadExpensesSummary() {
  const [open, closed] = await Promise.all([
    api.listReports({ status: 'open', limit: SHOWN }),
    api.listReports({ status: 'closed', limit: 1 }),
  ]);

  return {
    open: open.meta.total,
    closed: closed.meta.total,
    reports: open.data,
  };
}

/**
 * Prestacao de Contas no Inicio, cada relatorio aberto abrindo direto no
 * proprio detalhe. O resumo chega pronto do `HomeView`.
 */
export default function ExpensesHomeWidget({ module, onOpen, summaryPromise }) {
  const summary = use(summaryPromise);

  return (
    <Widget module={module} onOpen={onOpen}>
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
    </Widget>
  );
}
