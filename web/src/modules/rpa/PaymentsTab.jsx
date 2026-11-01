import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import * as api from '../../api';
import ConfirmDialog from '../../components/ConfirmDialog';
import {
  ADJUSTMENT_KINDS,
  PAYMENT_STATUSES,
  formatDate,
  formatMoney,
  formatSubcents,
  labelOf,
  parseMoneyToCents,
} from '../../constants';
import { ErrorAlert, Field, toError } from './common';

function addDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

/** A conta de cada pessoa, como a previa e a emissao devolvem. */
function PaymentTable({ payments, caption }) {
  return (
    <div className="rpa-grid-scroll">
      <table className="rpa-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Pessoa</th>
            <th scope="col">RPA</th>
            <th scope="col">Diarias</th>
            <th scope="col">Extras</th>
            <th scope="col">Correcoes</th>
            <th scope="col">Ajustes</th>
            <th scope="col">Liquido</th>
            <th scope="col">INSS</th>
            <th scope="col">IRRF</th>
            <th scope="col">Bruto</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={payment.worker_id}>
              <th scope="row">
                {payment.worker_number}. {payment.worker_name}
              </th>
              <td className="rpa-nowrap">
                {payment.number}º · {payment.code}
              </td>
              <td className="rpa-nowrap">
                {formatSubcents(payment.days.daily_subcents)}
              </td>
              <td>
                {formatSubcents(payment.days.extra_subcents)}
                {payment.deferred_extra_subcents > 0 && (
                  <div className="rpa-flag">
                    {formatSubcents(payment.deferred_extra_subcents)} de extra
                    fica para o proximo
                  </div>
                )}
              </td>
              <td>
                {formatSubcents(payment.days.correction_subcents)}
                {payment.lines
                  .filter((line) => line.part === 'correction')
                  .map((line) => (
                    <div key={line.date} className="rpa-flag">
                      correcao de {formatDate(line.date)}:{' '}
                      {formatSubcents(line.value_subcents)}
                    </div>
                  ))}
              </td>
              <td>
                {payment.adjustments.length === 0
                  ? '—'
                  : payment.adjustments.map((adjustment, index) => (
                      <div key={index}>
                        {labelOf(ADJUSTMENT_KINDS, adjustment.kind)}{' '}
                        {formatMoney(adjustment.amount_cents)}:{' '}
                        {adjustment.reason}
                      </div>
                    ))}
              </td>
              <td className="rpa-nowrap">
                <strong>{formatMoney(payment.net_cents)}</strong>
              </td>
              <td className="rpa-nowrap">{formatMoney(payment.inss_cents)}</td>
              <td className="rpa-nowrap">{formatMoney(payment.irrf_cents)}</td>
              <td className="rpa-nowrap">{formatMoney(payment.gross_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Pagamentos: periodo e data, os acrescimos e descontos com motivo, a previa
 * (que nao grava nada) e a emissao, que faz a mesma conta. Embaixo, os RPAs
 * emitidos; o emitido nao muda, so se cancela com motivo.
 */
export default function PaymentsTab({ launch, canWrite }) {
  const [form, setForm] = useState({
    period_start: launch.starts_on,
    period_end:
      addDays(launch.starts_on, 6) < launch.ends_on
        ? addDays(launch.starts_on, 6)
        : launch.ends_on,
    payment_date: '',
  });
  const [adjustments, setAdjustments] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [preview, setPreview] = useState(null);
  const [issued, setIssued] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [canceling, setCanceling] = useState(null);
  const [reason, setReason] = useState('');

  const loadIssued = useCallback(async () => {
    try {
      const [payments, team] = await Promise.all([
        api.listPayments(launch.id),
        api.listWorkers(launch.id),
      ]);
      setIssued(payments.data);
      setWorkers(team.data);
    } catch (caught) {
      setError(toError(caught));
    }
  }, [launch.id]);

  useEffect(() => {
    loadIssued();
  }, [loadIssued]);

  const set = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setPreview(null);
  };

  function body() {
    return {
      ...form,
      adjustments: adjustments
        .filter((adjustment) => adjustment.worker_id)
        .map((adjustment) => ({
          worker_id: Number(adjustment.worker_id),
          kind: adjustment.kind,
          amount_cents: parseMoneyToCents(adjustment.amount),
          reason: adjustment.reason.trim(),
        })),
    };
  }

  async function run(issue) {
    setBusy(true);
    setError(null);
    try {
      const response = await api.postPayments(launch.id, body(), {
        preview: !issue,
      });
      if (issue) {
        setPreview(null);
        setAdjustments([]);
        await loadIssued();
      } else {
        setPreview(response.data);
      }
    } catch (caught) {
      setError(toError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      await api.cancelPayment(canceling.id, reason);
      setCanceling(null);
      setReason('');
      await loadIssued();
    } catch (caught) {
      setError(toError(caught));
      setCanceling(null);
    } finally {
      setBusy(false);
    }
  }

  function setAdjustment(index, field, value) {
    setAdjustments((current) =>
      current.map((adjustment, at) =>
        at === index ? { ...adjustment, [field]: value } : adjustment,
      ),
    );
    setPreview(null);
  }

  return (
    <section aria-labelledby="payments-title" className="rpa-section">
      <h3 id="payments-title" className="rpa-section__title">
        Pagamentos
      </h3>

      {canWrite && (
        <form
          className="form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            run(false);
          }}
        >
          <div className="form__grid">
            <Field id="pay-start" label="Periodo: inicio">
              <input
                id="pay-start"
                type="date"
                className="field__input"
                value={form.period_start}
                onChange={set('period_start')}
              />
            </Field>
            <Field id="pay-end" label="Periodo: fim">
              <input
                id="pay-end"
                type="date"
                className="field__input"
                value={form.period_end}
                onChange={set('period_end')}
              />
            </Field>
            <Field id="pay-date" label="Data do pagamento">
              <input
                id="pay-date"
                type="date"
                className="field__input"
                value={form.payment_date}
                onChange={set('payment_date')}
              />
            </Field>
          </div>

          <fieldset className="rpa-fieldset">
            <legend>Acrescimos, bonus e descontos</legend>
            {adjustments.map((adjustment, index) => (
              <div key={index} className="rpa-adjustment">
                <select
                  className="field__input"
                  aria-label={`Pessoa do ajuste ${index + 1}`}
                  value={adjustment.worker_id}
                  onChange={(event) =>
                    setAdjustment(index, 'worker_id', event.target.value)
                  }
                >
                  <option value="">Pessoa</option>
                  {workers.map((worker) => (
                    <option key={worker.id} value={worker.id}>
                      {worker.number}. {worker.name}
                    </option>
                  ))}
                </select>
                <select
                  className="field__input"
                  aria-label={`Tipo do ajuste ${index + 1}`}
                  value={adjustment.kind}
                  onChange={(event) =>
                    setAdjustment(index, 'kind', event.target.value)
                  }
                >
                  {Object.entries(ADJUSTMENT_KINDS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <input
                  className="field__input"
                  inputMode="decimal"
                  aria-label={`Valor do ajuste ${index + 1}`}
                  placeholder="R$"
                  value={adjustment.amount}
                  onChange={(event) =>
                    setAdjustment(index, 'amount', event.target.value)
                  }
                />
                <input
                  className="field__input"
                  aria-label={`Motivo do ajuste ${index + 1}`}
                  placeholder="Motivo"
                  value={adjustment.reason}
                  onChange={(event) =>
                    setAdjustment(index, 'reason', event.target.value)
                  }
                />
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  aria-label={`Remover ajuste ${index + 1}`}
                  onClick={() =>
                    setAdjustments((current) =>
                      current.filter((_, at) => at !== index),
                    )
                  }
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn--sm"
              onClick={() =>
                setAdjustments((current) => [
                  ...current,
                  { worker_id: '', kind: 'bonus', amount: '', reason: '' },
                ])
              }
            >
              <Plus size={14} aria-hidden="true" />
              Ajuste
            </button>
          </fieldset>

          <div className="form__actions">
            <button type="submit" className="btn" disabled={busy}>
              {busy && !preview ? 'Calculando...' : 'Ver previa'}
            </button>
            {preview && preview.payments.length > 0 && (
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={() => run(true)}
              >
                {busy
                  ? 'Emitindo...'
                  : `Emitir ${preview.payments.length} RPA${preview.payments.length > 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </form>
      )}

      <ErrorAlert error={error} />

      {preview && (
        <section aria-labelledby="preview-title" className="rpa-subsection">
          <h4 id="preview-title">Previa (nada foi gravado)</h4>
          {preview.payments.length > 0 && (
            <>
              <PaymentTable
                payments={preview.payments}
                caption="Previa do pagamento"
              />
              <p className="filter__count">
                Total liquido:{' '}
                {formatMoney(
                  preview.payments.reduce((sum, p) => sum + p.net_cents, 0),
                )}
              </p>
            </>
          )}
          {preview.skipped.length > 0 && (
            <ul className="rpa-details" aria-label="Fora deste pagamento">
              {preview.skipped.map((entry) => (
                <li key={entry.worker_id}>
                  {entry.worker_number}. {entry.worker_name}: fica de fora —{' '}
                  {entry.reason}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="issued-title" className="rpa-subsection">
        <h4 id="issued-title">RPAs emitidos</h4>
        {issued.length === 0 ? (
          <p className="state">Nenhum RPA emitido ainda.</p>
        ) : (
          <div className="rpa-grid-scroll">
            <table className="rpa-table">
              <caption className="sr-only">RPAs emitidos</caption>
              <thead>
                <tr>
                  <th scope="col">Pessoa</th>
                  <th scope="col">Codigo</th>
                  <th scope="col">Periodo</th>
                  <th scope="col">Pagamento</th>
                  <th scope="col">Liquido</th>
                  <th scope="col">Bruto</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Acoes</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {issued.map((payment) => (
                  <tr key={payment.id}>
                    <th scope="row">
                      {payment.worker_number}. {payment.worker_name}
                    </th>
                    <td className="rpa-nowrap">{payment.code}</td>
                    <td>
                      {formatDate(payment.period_start)} a{' '}
                      {formatDate(payment.period_end)}
                    </td>
                    <td className="rpa-nowrap">
                      {formatDate(payment.payment_date)}
                    </td>
                    <td className="rpa-nowrap">
                      {formatMoney(payment.net_cents)}
                    </td>
                    <td className="rpa-nowrap">
                      {formatMoney(payment.gross_cents)}
                    </td>
                    <td>
                      <span
                        className={`badge badge--${payment.status === 'issued' ? 'open' : payment.status === 'paid' ? 'done' : 'failed'}`}
                      >
                        {labelOf(PAYMENT_STATUSES, payment.status)}
                      </span>
                      {payment.cancel_reason && (
                        <div className="rpa-flag">
                          motivo: {payment.cancel_reason}
                        </div>
                      )}
                    </td>
                    <td>
                      {canWrite && payment.status === 'issued' && (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          aria-label={`Cancelar RPA ${payment.code}`}
                          onClick={() => setCanceling(payment)}
                        >
                          Cancelar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canceling && (
        <ConfirmDialog
          title="Cancelar RPA"
          target={canceling.code}
          message="O RPA cancelado libera os dias e o numero para emitir de novo:"
          confirmLabel="Cancelar RPA"
          busyLabel="Cancelando..."
          busy={busy}
          onCancel={() => {
            setCanceling(null);
            setReason('');
          }}
          onConfirm={cancel}
        >
          <div className="field">
            <label className="field__label" htmlFor="cancel-reason">
              Motivo
            </label>
            <input
              id="cancel-reason"
              className="field__input"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        </ConfirmDialog>
      )}
    </section>
  );
}
