import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import * as api from '../../api';
import { ApiError } from '../../api';
import { LAUNCH_STATUSES, formatDate, labelOf } from '../../constants';
import LaunchForm from './LaunchForm';
import TeamTab from './TeamTab';
import TimesheetTab from './TimesheetTab';
import PaymentsTab from './PaymentsTab';
import EmissionTab from './EmissionTab';
import DocumentsTab from './DocumentsTab';
import ReceiptsTab from './ReceiptsTab';
import { ErrorAlert, toError } from './common';

// As etapas do processo, na ordem em que acontecem (issue 35).
const TABS = [
  ['team', 'Equipe', TeamTab],
  ['timesheet', 'Ponto', TimesheetTab],
  ['payments', 'Pagamentos', PaymentsTab],
  ['emission', 'Emissao', EmissionTab],
  ['documents', 'Documentos', DocumentsTab],
  ['receipts', 'Recibos', ReceiptsTab],
];

/**
 * Um lancamento: os dados dele no topo e uma etapa por vez embaixo. Encerrado,
 * tudo fica so leitura ate reabrir — como o relatorio fechado.
 */
export default function LaunchDetail({ launchId, canWrite, onBack }) {
  const [launch, setLaunch] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('team');
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const load = useCallback(async () => {
    try {
      const response = await api.getLaunch(launchId);
      setLaunch(response.data);
      setError(null);
    } catch (caught) {
      setError(toError(caught));
    }
  }, [launchId]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(payload) {
    setSubmitting(true);
    setFieldErrors({});
    try {
      const response = await api.updateLaunch(launchId, payload);
      setLaunch(response.data);
      setEditing(false);
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors());
      setError(toError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function setStatus(status) {
    try {
      const response = await api.updateLaunch(launchId, { status });
      setLaunch(response.data);
    } catch (caught) {
      setError(toError(caught));
    }
  }

  if (!launch) {
    return (
      <>
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          Voltar
        </button>
        {error ? (
          <ErrorAlert error={error} />
        ) : (
          <p className="state">Carregando lancamento...</p>
        )}
      </>
    );
  }

  const open = launch.status === 'open';
  const writable = canWrite && open;
  const Current = TABS.find(([id]) => id === tab)[2];

  return (
    <div className="rpa">
      <div className="toolbar">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          Voltar
        </button>
        {canWrite && (
          <div className="toolbar__group">
            {open && !editing && (
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setEditing(true)}
              >
                Editar lancamento
              </button>
            )}
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setStatus(open ? 'closed' : 'open')}
            >
              {open ? 'Encerrar lancamento' : 'Reabrir lancamento'}
            </button>
          </div>
        )}
      </div>

      <section className="card" aria-labelledby="launch-title">
        <h3 className="card__title" id="launch-title">
          {launch.development} — {launch.city}/{launch.state}
        </h3>
        <dl className="details">
          <div>
            <dt>Status</dt>
            <dd>
              <span className={`badge badge--${launch.status}`}>
                {labelOf(LAUNCH_STATUSES, launch.status)}
              </span>
            </dd>
          </div>
          <div>
            <dt>Empresa</dt>
            <dd>
              {launch.company_code} - {launch.company_name}
            </dd>
          </div>
          <div>
            <dt>Periodo</dt>
            <dd>
              {formatDate(launch.starts_on)} a {formatDate(launch.ends_on)}
            </dd>
          </div>
          <div>
            <dt>Tipo de servico</dt>
            <dd>{launch.service_type || 'Nao informado'}</dd>
          </div>
          <div>
            <dt>Centro de custo</dt>
            <dd>{launch.cost_center || 'Nao informado'}</dd>
          </div>
        </dl>
        {!open && (
          <p className="state">Lancamento encerrado: so leitura ate reabrir.</p>
        )}
      </section>

      <ErrorAlert error={error} />

      {editing && (
        <LaunchForm
          launch={launch}
          companies={[]}
          onSubmit={save}
          onCancel={() => {
            setEditing(false);
            setFieldErrors({});
            setError(null);
          }}
          submitting={submitting}
          serverErrors={fieldErrors}
        />
      )}

      <nav className="filter rpa-tabs" aria-label="Etapas do lancamento">
        {TABS.map(([id, name]) => (
          <button
            key={id}
            type="button"
            className="filter__option"
            aria-current={tab === id ? 'page' : undefined}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {name}
          </button>
        ))}
      </nav>

      <Current
        key={`${tab}-${launch.updated_at}`}
        launch={launch}
        canWrite={writable}
      />
    </div>
  );
}
