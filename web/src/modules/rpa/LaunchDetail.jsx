import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import * as api from '../../api';
import { ApiError } from '../../api';
import ConfirmDialog from '../../components/ConfirmDialog';
import {
  LAUNCH_STATUSES,
  formatDate,
  formatMoney,
  labelOf,
} from '../../constants';
import LaunchForm from './LaunchForm';
import TeamTab from './TeamTab';
import TimesheetTab from './TimesheetTab';
import PaymentsTab from './PaymentsTab';
import EmissionTab from './EmissionTab';
import DocumentsTab from './DocumentsTab';
import ReceiptsTab from './ReceiptsTab';
import { BalanceList, ErrorAlert, toError } from './common';

// As etapas do processo, na ordem em que acontecem (issue 35).
const TABS = [
  ['team', 'Equipe', TeamTab],
  ['timesheet', 'Ponto', TimesheetTab],
  ['payments', 'Pagamentos', PaymentsTab],
  ['emission', 'Emissao', EmissionTab],
  ['documents', 'Documentos', DocumentsTab],
  ['receipts', 'Recibos', ReceiptsTab],
];

function valueText(cents) {
  if (cents === 0) return 'sem diferenca de valor';
  return `${formatMoney(Math.abs(cents))} ${cents > 0 ? 'a pagar' : 'a descontar'}`;
}

/** "Isso muda 33 dias ja pagos de 6 pessoas: R$ 330,00 a pagar...". */
function effectMessage(effect) {
  return (
    `Isso muda ${effect.days} dia(s) ja pago(s) de ${effect.people} ` +
    `pessoa(s): ${valueText(effect.value_cents)} no proximo pagamento. ` +
    'Para mudar a diaria a partir de uma data, feche a vigencia atual e ' +
    'crie outra.'
  );
}

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
  // O saldo pendente de quem ainda tem extra adiado ou correcao: encerrar
  // com ele so avisa (issue 60), e quem decide e quem encerra.
  const [closing, setClosing] = useState(null);
  const [busy, setBusy] = useState(false);
  // A mudanca que refaz dia ja pago (diaria, feriado, horario) pergunta antes
  // de salvar, com o efeito (issue 71).
  const [changing, setChanging] = useState(null);

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

  async function commit(payload) {
    const response = await api.updateLaunch(launchId, payload);
    setLaunch(response.data);
    setEditing(false);
    setError(null);
  }

  async function run(work) {
    setSubmitting(true);
    setFieldErrors({});
    try {
      await work();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors());
      setError(toError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  function save(payload) {
    return run(async () => {
      const { data } = await api.updateLaunch(launchId, payload, {
        preview: true,
      });
      if (data.effect.days > 0) {
        setChanging({ payload, effect: data.effect });
      } else {
        await commit(payload);
      }
    });
  }

  function confirmChange() {
    return run(async () => {
      try {
        await commit(changing.payload);
      } finally {
        setChanging(null);
      }
    });
  }

  async function setStatus(status) {
    try {
      const response = await api.updateLaunch(launchId, { status });
      setLaunch(response.data);
    } catch (caught) {
      setError(toError(caught));
    }
  }

  async function requestClose() {
    try {
      const response = await api.getLaunchBalances(launchId);
      if (response.data.length > 0) {
        setClosing(response.data);
      } else {
        await setStatus('closed');
      }
    } catch (caught) {
      setError(toError(caught));
    }
  }

  async function confirmClose() {
    setBusy(true);
    await setStatus('closed');
    setBusy(false);
    setClosing(null);
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
            {!launch.purged_at && (
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => (open ? requestClose() : setStatus('open'))}
              >
                {open ? 'Encerrar lancamento' : 'Reabrir lancamento'}
              </button>
            )}
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
        {!open && !launch.purged_at && (
          <p className="state">
            Lancamento encerrado: so leitura ate reabrir. Os dados pessoais da
            equipe e os arquivos sao apagados a partir de{' '}
            {formatDate(launch.purge_on)}, um mes depois de encerrar.
          </p>
        )}
        {launch.purged_at && (
          <p className="state">
            Dados pessoais da equipe e arquivos apagados pela retencao em{' '}
            {formatDate(launch.purged_on)}. Ficam nomes, CPFs e os valores dos
            RPAs; o lancamento nao reabre.
          </p>
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

      {changing && (
        <ConfirmDialog
          title="Mudar dias ja pagos"
          message={effectMessage(changing.effect)}
          confirmLabel="Salvar mesmo assim"
          busyLabel="Salvando..."
          busy={submitting}
          onCancel={() => setChanging(null)}
          onConfirm={confirmChange}
        >
          <ul className="rpa-details" aria-label="Efeito nos dias ja pagos">
            {changing.effect.workers.map((worker) => (
              <li key={worker.worker_id}>
                {worker.worker_number}. {worker.worker_name}:{' '}
                {worker.days.length} dia(s), {valueText(worker.value_cents)}
                {worker.unpriced_days.length > 0 &&
                  `; sem diaria vigente em ${worker.unpriced_days.map(formatDate).join(', ')}`}
              </li>
            ))}
          </ul>
        </ConfirmDialog>
      )}

      {closing && (
        <ConfirmDialog
          title="Encerrar com saldo pendente"
          message="Extra adiado e correcao de dia ja pago so entram num proximo pagamento, e o lancamento encerrado nao emite RPA:"
          confirmLabel="Encerrar mesmo assim"
          busyLabel="Encerrando..."
          busy={busy}
          onCancel={() => setClosing(null)}
          onConfirm={confirmClose}
        >
          <BalanceList balances={closing} label="Saldo pendente ao encerrar" />
        </ConfirmDialog>
      )}
    </div>
  );
}
