import { formatDate, formatMoney, reportStatusLabel } from '../constants';

export default function ReportList({ reports, onOpen, onCreate }) {
  return (
    <>
      <div className="toolbar">
        <span className="filter__count" aria-live="polite">
          {reports.length} {reports.length === 1 ? 'relatorio' : 'relatorios'}
        </span>
        <button type="button" className="btn btn--primary" onClick={onCreate}>
          Novo relatorio
        </button>
      </div>

      {reports.length === 0 ? (
        <p className="state">Nenhum relatorio ainda.</p>
      ) : (
        <ul className="list">
          {reports.map((report) => (
            <li key={report.id} className="list-item">
              <div className="list-item__main">
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onOpen(report.id)}
                >
                  {report.title}
                </button>
                <div className="list-item__meta">
                  <span className={`badge badge--${report.status}`}>
                    {reportStatusLabel(report.status)}
                  </span>
                  <span>
                    {formatDate(report.period_start)} a{' '}
                    {formatDate(report.period_end)}
                  </span>
                  {report.advance_cents > 0 && (
                    <span>
                      Adiantamento: {formatMoney(report.advance_cents)}
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
