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
  canWrite = true,
  readOnlyReason,
}) {
  const [values, setValues] = useState({
    issued_at: receipt.issued_at ?? '',
    amount_cents: centsToInputValue(receipt.amount_cents),
    category: receipt.category ?? '',
    access_key: '',
    issuer_name: receipt.issuer_name ?? '',
    issuer_city: receipt.issuer_city ?? '',
    cnpj: '',
  });

  // A chave so e pedida quando a extracao nao a achou. Com ela no comprovante
  // nao ha o que digitar: sao 44 caracteres que ninguem confere a olho, e o DV
  // ja os conferiu quando ela foi lida.
  const askForKey = !receipt.access_key;

  // Sem emitente cadastrado — o recibo manuscrito, sem CNPJ legivel —, nome e
  // cidade vem do proprio papel e se corrigem aqui. Com emitente, quem fala e
  // o cadastro, e a planilha usa o dele.
  const askForIssuer = !receipt.merchant_id;
  const [localErrors, setLocalErrors] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [zoom, setZoom] = useState(1);
  // O giro e gravado na hora e vale para a imagem, o reprocessamento e o PDF
  // consolidado. Fica no estado local para a imagem trocar sem remontar a
  // revisao: zoom e rolagem continuam onde estavam.
  const [rotation, setRotation] = useState(receipt.rotation ?? 0);
  const [rotating, setRotating] = useState(false);
  const [loadedRotation, setLoadedRotation] = useState(null);

  // Emitente ainda sem categoria: a escolha desta revisao vira o cadastro dele
  // por padrao, que e o caso de uso (7 dos 28 cupons do caso-base eram do
  // mesmo CNPJ). Emitente ja classificado comeca desmarcado, para nao trocar
  // um cadastro sem querer ao corrigir um cupom fora do padrao.
  const [applyToMerchant, setApplyToMerchant] = useState(
    !receipt.merchant_default_category ||
      receipt.merchant_default_category === 'nao_classificado',
  );

  // O destaque some assim que a pessoa escolhe outra categoria: a partir dai a
  // decisao e dela, e continuar avisando "isto e um palpite" seria mentira.
  const guessedCategory =
    Boolean(receipt.category_guessed) &&
    values.category === (receipt.category ?? '');
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

  // So oferece quando ha emitente e a escolha difere do que ele ja tem: com a
  // mesma categoria no cadastro nao ha o que atualizar.
  const offerMerchantUpdate =
    canWrite &&
    Boolean(receipt.merchant_id) &&
    Boolean(values.category) &&
    values.category !== receipt.merchant_default_category;
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
      // O emitente vai primeiro: se o cadastro falhar, nada foi confirmado e a
      // pessoa tenta de novo. Na ordem inversa, o cupom ficaria confirmado e
      // o cadastro, nao — e a tela ja teria avancado para o proximo.
      if (offerMerchantUpdate && applyToMerchant) {
        await api.setMerchantCategory(receipt.merchant_id, values.category);
      }

      // A chave digitada vai junto: se ela nao fechar o DV, o 422 volta no
      // campo e nada e confirmado — o que a pessoa digitou fica na tela.
      const typedKey = askForKey ? values.access_key.trim() : '';
      // Com a chave digitada, o CNPJ vem dela: mandar os dois seria pedir ao
      // servidor que escolhesse entre eles.
      const typedCnpj = askForIssuer && !typedKey ? values.cnpj.trim() : '';

      await api.updateReceipt(receipt.id, {
        issued_at: values.issued_at,
        amount_cents: amountCents,
        category: values.category,
        status: 'confirmed',
        ...(typedKey ? { access_key: typedKey } : {}),
        ...(askForIssuer
          ? { issuer_name: values.issuer_name, issuer_city: values.issuer_city }
          : {}),
        ...(typedCnpj ? { cnpj: typedCnpj } : {}),
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
    // Girada, a imagem troca de proporcao: mede de novo quando a nova chega.
  }, [zoom, imageLoaded, loadedRotation]);

  /** Quarto de volta: +90 no sentido horario, -90 no anti-horario. */
  async function rotate(delta) {
    const next = (rotation + delta + 360) % 360;

    setRotating(true);
    setError(null);

    try {
      await api.updateReceipt(receipt.id, { rotation: next });
      setRotation(next);
    } catch (caught) {
      setError({ message: caught.message, action: caught.action });
    } finally {
      setRotating(false);
    }
  }

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
        {canWrite && (
          <button
            type="button"
            className="btn btn--sm btn--danger"
            onClick={() => onDelete(receipt)}
            disabled={submitting}
          >
            Deletar
          </button>
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
                {canWrite && alert.rule === 'possivel_duplicata' && (
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
            {canWrite && (
              <>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => rotate(-90)}
                  disabled={rotating}
                  aria-label="Girar para a esquerda"
                >
                  ↺
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => rotate(90)}
                  disabled={rotating}
                  aria-label="Girar para a direita"
                >
                  ↻
                </button>
              </>
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
                  // A URL muda com o giro: o navegador guarda a imagem para
                  // revalidar, e sem isso mostraria a copia sem perguntar.
                  src={api.receiptImageUrl(receipt.id, rotation)}
                  alt={`Comprovante #${receipt.id}`}
                  // Sem isso o navegador trata o gesto como "arrastar imagem"
                  // e o cupom sai voando atras do cursor como fantasma.
                  draggable={false}
                  hidden={!imageLoaded}
                  style={{ transform: `scale(${zoom})` }}
                  onLoad={() => {
                    setImageLoaded(true);
                    setLoadedRotation(rotation);
                  }}
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
          </div>

          {/* Um fieldset desabilitado trava os campos de uma vez, com a
              semantica nativa: o leitor de tela anuncia os campos como
              indisponiveis, e nenhum Enter confirma por acidente. */}
          <fieldset className="review__fieldset" disabled={!canWrite}>
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
                onChange={(event) =>
                  setField('amount_cents', event.target.value)
                }
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
                className={
                  guessedCategory
                    ? 'field__input field__input--guess'
                    : 'field__input'
                }
                value={values.category}
                aria-invalid={Boolean(errors.category)}
                aria-describedby={
                  guessedCategory ? 'review-category-guess' : undefined
                }
                onChange={(event) => setField('category', event.target.value)}
              >
                <option value="">Selecione...</option>
                {EXPENSE_CATEGORIES.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </select>
              {/* O palpite vem do nome do emitente, nao do CNPJ cadastrado: dizer
                isso e o que separa "a ferramenta leu" de "a ferramenta
                chutou". Sem essa linha o campo chegaria com a mesma cara de um
                dado conferido. */}
              {guessedCategory && (
                <span className="field__hint" id="review-category-guess">
                  Sugerida pelo nome do emitente — confira antes de confirmar.
                </span>
              )}
              {errors.category && (
                <span className="field__error" role="alert">
                  {errors.category}
                </span>
              )}
            </div>

            {askForIssuer && (
              <>
                <div className="field">
                  <label className="field__label" htmlFor="review-issuer-name">
                    Estabelecimento
                  </label>
                  <input
                    id="review-issuer-name"
                    className="field__input"
                    type="text"
                    value={values.issuer_name}
                    aria-invalid={Boolean(errors.issuer_name)}
                    onChange={(event) =>
                      setField('issuer_name', event.target.value)
                    }
                  />
                  {errors.issuer_name && (
                    <span className="field__error" role="alert">
                      {errors.issuer_name}
                    </span>
                  )}
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="review-issuer-city">
                    Cidade
                  </label>
                  <input
                    id="review-issuer-city"
                    className="field__input"
                    type="text"
                    value={values.issuer_city}
                    aria-invalid={Boolean(errors.issuer_city)}
                    aria-describedby="review-issuer-city-hint"
                    onChange={(event) =>
                      setField('issuer_city', event.target.value)
                    }
                  />
                  <span className="field__hint" id="review-issuer-city-hint">
                    Como esta no comprovante, nunca a do destino da viagem.
                  </span>
                  {errors.issuer_city && (
                    <span className="field__error" role="alert">
                      {errors.issuer_city}
                    </span>
                  )}
                </div>
              </>
            )}

            {askForKey && (
              <div className="field">
                <label className="field__label" htmlFor="review-access-key">
                  Chave de acesso
                </label>
                <input
                  id="review-access-key"
                  className="field__input"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={values.access_key}
                  aria-invalid={Boolean(errors.access_key)}
                  aria-describedby="review-access-key-hint"
                  onChange={(event) =>
                    setField('access_key', event.target.value)
                  }
                />
                <span className="field__hint" id="review-access-key-hint">
                  Opcional. Os 44 caracteres do cupom, com ou sem espacos — o
                  digito verificador confere a digitacao.
                </span>
                {errors.access_key && (
                  <span className="field__error" role="alert">
                    {errors.access_key}
                  </span>
                )}
              </div>
            )}

            {askForIssuer && askForKey && (
              <div className="field">
                <label className="field__label" htmlFor="review-cnpj">
                  CNPJ
                </label>
                <input
                  id="review-cnpj"
                  className="field__input"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={values.cnpj}
                  aria-invalid={Boolean(errors.cnpj)}
                  aria-describedby="review-cnpj-hint"
                  onChange={(event) => setField('cnpj', event.target.value)}
                />
                <span className="field__hint" id="review-cnpj-hint">
                  Opcional, sem chave de acesso: o do carimbo ou do cabecalho.
                  Vincula o emitente e a categoria do cadastro dele.
                </span>
                {errors.cnpj && (
                  <span className="field__error" role="alert">
                    {errors.cnpj}
                  </span>
                )}
              </div>
            )}

            {offerMerchantUpdate && (
              <label className="field field--checkbox">
                <input
                  type="checkbox"
                  checked={applyToMerchant}
                  onChange={(event) => setApplyToMerchant(event.target.checked)}
                />
                <span>
                  Usar esta categoria nos proximos cupons de{' '}
                  {receipt.merchant_name || 'este emitente'}
                </span>
              </label>
            )}
          </fieldset>

          <div className="form__actions">
            {canWrite ? (
              <>
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
              </>
            ) : (
              <span className="field__hint">
                {readOnlyReason ??
                  'Somente leitura: seu acesso confere os comprovantes, mas nao os altera.'}{' '}
                Atalhos: Esc volta · Alt+← / Alt+→ navega
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
