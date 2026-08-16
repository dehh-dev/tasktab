import { useEffect, useState } from 'react';
import * as api from '../api';
import { ApiError } from '../api';
import {
  EXPENSE_CATEGORIES,
  centsToInputValue,
  formatDate,
  parseMoneyToCents,
  sourceLabel,
} from '../constants';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

const LOW_CONFIDENCE = 0.7;

/**
 * A confianca gravada e uma so por comprovante, nao por campo: o pipeline de
 * extracao (pipeline.service.js, `lowestConfidence`) resume tudo num numero
 * so, o do campo mais fraco. Por isso o destaque de "baixa confianca" e do
 * comprovante inteiro, e nao de um campo especifico — nao ha o dado para
 * fazer diferente sem mudar o schema.
 */
function ConfidenceBadge({ receipt }) {
  if (receipt.extraction_source === 'manual' || !receipt.extraction_source) {
    return (
      <span className="badge badge--confirmed">
        {sourceLabel(receipt.extraction_source)}
      </span>
    );
  }

  const confidence = Number(receipt.confidence);
  const low = !Number.isFinite(confidence) || confidence < LOW_CONFIDENCE;
  const pct = Number.isFinite(confidence) ? Math.round(confidence * 100) : null;

  return (
    <span className={`badge badge--${low ? 'needs_review' : 'confirmed'}`}>
      {sourceLabel(receipt.extraction_source)}
      {pct !== null && ` · ${pct}%`}
      {low && ' · baixa confianca'}
    </span>
  );
}

function alertKey(alert) {
  return `${alert.rule}:${alert.receipt_id}:${alert.related_id ?? ''}`;
}

export default function ReceiptReview({
  receipt,
  alerts,
  queuePosition,
  queueTotal,
  onNavigate,
  onBack,
  onAction,
}) {
  const [values, setValues] = useState({
    issued_at: receipt.issued_at ?? '',
    amount_cents: centsToInputValue(receipt.amount_cents),
    category: receipt.category ?? '',
  });
  const [localErrors, setLocalErrors] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [dismissed, setDismissed] = useState(() => new Set());

  const errors = { ...serverErrors, ...localErrors };
  const visibleAlerts = alerts.filter(
    (alert) => !dismissed.has(alertKey(alert)),
  );

  function setField(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
    setLocalErrors((current) => {
      if (!current[field]) {
        return current;
      }
      const { [field]: _removed, ...rest } = current;
      return rest;
    });
    setServerErrors((current) => {
      if (!current[field]) {
        return current;
      }
      const { [field]: _removed, ...rest } = current;
      return rest;
    });
  }

  function dismissAlert(alert) {
    setDismissed((current) => new Set(current).add(alertKey(alert)));
  }

  async function markAsDuplicate(alert) {
    setSubmitting(true);
    try {
      await api.updateReceipt(receipt.id, { status: 'duplicate' });
      dismissAlert(alert);
      // onAction recarrega no componente pai e avanca usando o array recem
      // devolvido pelo fetch — nao o `receipts` capturado aqui, que estaria
      // desatualizado assim que o await acima resolve.
      await onAction();
    } catch (caught) {
      setError({ message: caught.message, action: caught.action });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirm(event) {
    event.preventDefault();

    const amountCents = parseMoneyToCents(values.amount_cents);
    const found = {};
    if (!values.issued_at) {
      found.issued_at = 'issued_at e obrigatorio';
    }
    if (amountCents === null) {
      found.amount_cents = 'amount_cents deve ser um valor valido';
    }
    if (!values.category) {
      found.category = 'category e obrigatorio';
    }

    if (Object.keys(found).length > 0) {
      setLocalErrors(found);
      return;
    }

    setSubmitting(true);
    setServerErrors({});
    setError(null);

    try {
      await api.updateReceipt(receipt.id, {
        issued_at: values.issued_at,
        amount_cents: amountCents,
        category: values.category,
        status: 'confirmed',
      });
      await onAction();
    } catch (caught) {
      const byField = caught instanceof ApiError ? caught.fieldErrors() : {};
      if (Object.keys(byField).length > 0) {
        setServerErrors(byField);
      } else {
        setError({ message: caught.message, action: caught.action });
      }
    } finally {
      setSubmitting(false);
    }
  }

  // No document, nao num onKeyDown de div: um atalho que so funciona quando
  // o foco por acaso esta dentro de um container nao-focavel e fragil demais
  // — apos trocar de comprovante (o componente remonta via `key`), o foco
  // pode ficar fora da arvore, e o atalho para de responder em silencio. Foi
  // assim que Escape parou de fechar a tela depois de um Alt+seta. Mesmo
  // padrao ja usado pelo ConfirmDialog.
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        onBack();
        return;
      }
      if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault();
        onNavigate('next');
      }
      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        onNavigate('previous');
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onBack, onNavigate]);

  function handleWheelZoom(event) {
    event.preventDefault();
    setZoom((current) => {
      const next = current + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
      return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    });
  }

  return (
    <div className="review">
      <div className="toolbar">
        <button type="button" className="btn" onClick={onBack}>
          Voltar a lista
        </button>
        {queueTotal > 0 && (
          <div className="toolbar__group">
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => onNavigate('previous')}
              disabled={queueTotal <= 1}
            >
              ← Anterior
            </button>
            <span className="filter__count">
              {queuePosition} de {queueTotal} pendentes
            </span>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => onNavigate('next')}
              disabled={queueTotal <= 1}
            >
              Proximo →
            </button>
          </div>
        )}
      </div>

      {visibleAlerts.length > 0 && (
        <div className="alerts">
          {visibleAlerts.map((alert) => (
            <div
              key={alertKey(alert)}
              className="alert"
              role="alert"
              data-severity={alert.severity}
            >
              <div className="alert__title">
                {alert.severity === 'erro' ? 'Erro' : 'Aviso'}
              </div>
              <div>{alert.message}</div>
              <div className="alert__actions">
                {alert.rule === 'possivel_duplicata' && (
                  <button
                    type="button"
                    className="btn btn--sm btn--danger"
                    onClick={() => markAsDuplicate(alert)}
                    disabled={submitting}
                  >
                    Marcar como duplicata
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => dismissAlert(alert)}
                >
                  Dispensar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="alert" role="alert">
          <div className="alert__title">{error.message}</div>
          {error.action && <div>{error.action}</div>}
        </div>
      )}

      <div className="review__grid">
        <div className="review__image-pane">
          <div className="review__zoom-controls">
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
              aria-label="Diminuir zoom"
            >
              −
            </button>
            <span className="filter__count">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
              aria-label="Aumentar zoom"
            >
              +
            </button>
            {zoom !== 1 && (
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setZoom(1)}
              >
                Redefinir
              </button>
            )}
          </div>

          <div className="review__image-scroll" onWheel={handleWheelZoom}>
            {imageFailed ? (
              <p className="state">
                Nao foi possivel carregar a imagem deste comprovante.
              </p>
            ) : (
              <>
                {!imageLoaded && (
                  // Renderizar a pagina custa mais que servir um arquivo
                  // estatico — sem isso a tela fica com um vazio sem
                  // explicacao por alguns segundos, o que parece quebrado.
                  <p className="state">Carregando imagem...</p>
                )}
                <img
                  className="review__image"
                  src={api.receiptImageUrl(receipt.id)}
                  alt={`Comprovante #${receipt.id}`}
                  hidden={!imageLoaded}
                  style={{ transform: `scale(${zoom})` }}
                  onLoad={() => setImageLoaded(true)}
                  onError={() => setImageFailed(true)}
                />
              </>
            )}
          </div>
        </div>

        <form
          className="form review__fields"
          onSubmit={handleConfirm}
          noValidate
        >
          <div className="task__meta">
            <ConfidenceBadge receipt={receipt} />
            {receipt.access_key && (
              <span className="filter__count">Chave: {receipt.access_key}</span>
            )}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="review-date">
              Data
              <span className="field__required" aria-hidden="true">
                *
              </span>
            </label>
            <input
              id="review-date"
              className="field__input"
              type="date"
              value={values.issued_at}
              aria-invalid={Boolean(errors.issued_at)}
              onChange={(event) => setField('issued_at', event.target.value)}
            />
            {errors.issued_at && (
              <span className="field__error" role="alert">
                {errors.issued_at}
              </span>
            )}
            {receipt.issued_at && (
              <span className="field__hint">
                Extraido: {formatDate(receipt.issued_at)}
              </span>
            )}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="review-amount">
              Valor (R$)
              <span className="field__required" aria-hidden="true">
                *
              </span>
            </label>
            <input
              id="review-amount"
              className="field__input"
              type="text"
              inputMode="decimal"
              value={values.amount_cents}
              aria-invalid={Boolean(errors.amount_cents)}
              onChange={(event) => setField('amount_cents', event.target.value)}
            />
            {errors.amount_cents && (
              <span className="field__error" role="alert">
                {errors.amount_cents}
              </span>
            )}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="review-category">
              Categoria
              <span className="field__required" aria-hidden="true">
                *
              </span>
            </label>
            <select
              id="review-category"
              className="field__input"
              value={values.category}
              aria-invalid={Boolean(errors.category)}
              onChange={(event) => setField('category', event.target.value)}
            >
              <option value="">Selecione...</option>
              {EXPENSE_CATEGORIES.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
            {errors.category && (
              <span className="field__error" role="alert">
                {errors.category}
              </span>
            )}
          </div>

          <div className="form__actions">
            <span className="field__hint">
              Atalhos: Enter confirma · Esc volta · Alt+← / Alt+→ navega
            </span>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={submitting}
            >
              {submitting ? 'Salvando...' : 'Confirmar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
