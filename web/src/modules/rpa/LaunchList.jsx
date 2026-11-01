import { Plus } from 'lucide-react';
import { LAUNCH_STATUSES, formatDate, labelOf } from '../../constants';

/** Os lancamentos, do mais novo para o mais velho. */
export default function LaunchList({ launches, onOpen, onCreate }) {
  return (
    <>
      <div className="toolbar">
        <span className="filter__count" aria-live="polite">
          {launches.length}{' '}
          {launches.length === 1 ? 'lancamento' : 'lancamentos'}
        </span>
        {onCreate && (
          <button type="button" className="btn btn--primary" onClick={onCreate}>
            <Plus size={16} aria-hidden="true" />
            Novo lancamento
          </button>
        )}
      </div>

      {launches.length === 0 ? (
        <p className="state">Nenhum lancamento ainda.</p>
      ) : (
        <ul className="list">
          {launches.map((launch) => (
            <li key={launch.id} className="list-item">
              <div className="list-item__main">
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onOpen(launch.id)}
                >
                  {launch.development} — {launch.city}/{launch.state}
                </button>
                <div className="list-item__meta">
                  <span className={`badge badge--${launch.status}`}>
                    {labelOf(LAUNCH_STATUSES, launch.status)}
                  </span>
                  <span>
                    {formatDate(launch.starts_on)} a{' '}
                    {formatDate(launch.ends_on)}
                  </span>
                  <span>Empresa {launch.company_code}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
