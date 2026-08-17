import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  onDelete,
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

  const scrollRef = useRef(null);
  // Os dados do gesto em curso ficam num ref, nao em estado: eles mudam a cada
  // pixel de movimento e nada na tela depende deles diretamente — re-renderizar
  // por causa disso derrubaria o arrasto para um engasgo.
  const dragRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [pannable, setPannable] = useState(false);

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
      // Com o ConfirmDialog aberto os atalhos sao dele. O keydown do Escape
      // borbulha ate o document antes de o <dialog> disparar `cancel`, entao
      // sem esta guarda um Escape cancelaria a exclusao e ainda fecharia a
      // revisao junto, jogando a pessoa na lista sem ela ter pedido.
      if (document.querySelector('dialog[open]')) {
        return;
      }

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

  // O cupom cabe inteiro? Entao nao ha o que arrastar, e o ponteiro nao deve
  // prometer que ha. Medido depois do layout, porque depende do zoom e das
  // dimensoes reais da imagem — que so existem depois que ela carrega.
  useLayoutEffect(() => {
    const box = scrollRef.current;

    if (!box) {
      return;
    }

    setPannable(
      box.scrollWidth > box.clientWidth || box.scrollHeight > box.clientHeight,
    );
  }, [zoom, imageLoaded]);

  /**
   * Arrastar para navegar pelo cupom ampliado. Mexe no `scrollLeft`/`scrollTop`
   * do proprio container em vez de reimplementar rolagem com `transform`: assim
   * as barras, a roda do mouse e o teclado continuam falando da mesma posicao,
   * sem um segundo sistema de coordenadas para manter em sincronia.
   */
  function handlePointerDown(event) {
    const box = scrollRef.current;

    // So o botao esquerdo. O do meio e o direito tem significado proprio no
    // navegador, e sequestra-los surpreenderia mais do que ajudaria.
    if (event.button !== 0 || !box || !pannable) {
      return;
    }

    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scrollLeft: box.scrollLeft,
      scrollTop: box.scrollTop,
    };

    // Captura do ponteiro: sem isso, soltar o botao fora do painel (ou fora da
    // janela) nunca entrega o `pointerup`, e o arrasto fica grudado no cursor.
    // Ha spec E2E do caso, verificada falhando sem esta linha.
    box.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function handlePointerMove(event) {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    // O gesto e puxar o papel, nao mover uma camera: a imagem acompanha o
    // ponteiro, entao o scroll anda na direcao contraria.
    const box = scrollRef.current;
    box.scrollLeft = drag.scrollLeft - (event.clientX - drag.x);
    box.scrollTop = drag.scrollTop - (event.clientY - drag.y);
  }

  function endDrag(event) {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const box = scrollRef.current;

    if (box.hasPointerCapture(event.pointerId)) {
      box.releasePointerCapture(event.pointerId);
    }

    dragRef.current = null;
    setDragging(false);
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
        {/* Descartar e decisao que se toma olhando a imagem, nao a lista: o
            cupom que nao deveria estar aqui so se revela quando aparece na
            tela. O dialogo e o estado ficam na ReportDetail. */}
        <button
          type="button"
          className="btn btn--sm btn--danger"
          onClick={() => onDelete(receipt)}
          disabled={submitting}
        >
          Deletar
        </button>
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

          {/* Focavel de proposito: com o cupom ampliado, quem navega por
              teclado tambem precisa alcancar o que saiu da area visivel — as
              setas rolam o container nativamente. */}
          <div
            className={[
              'review__image-scroll',
              pannable && 'review__image-scroll--pannable',
              dragging && 'review__image-scroll--dragging',
            ]
              .filter(Boolean)
              .join(' ')}
            ref={scrollRef}
            tabIndex={0}
            aria-label="Imagem do comprovante — arraste para mover"
            onWheel={handleWheelZoom}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
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
                  // Sem isso o navegador trata o gesto como "arrastar imagem"
                  // e o cupom sai voando atras do cursor como fantasma.
                  draggable={false}
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
