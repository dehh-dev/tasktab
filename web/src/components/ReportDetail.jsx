import { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import ReceiptUpload from './ReceiptUpload';
import ReceiptSummary from './ReceiptSummary';
import ReceiptList from './ReceiptList';
import ReceiptReview from './ReceiptReview';
import { formatDate, formatMoney, reportStatusLabel } from '../constants';

const POLL_INTERVAL_MS = 1500;
const EMPTY_META = { total: 0, total_cents: 0, by_category: {} };

/** Ids dos comprovantes que ainda precisam de revisao, na ordem da lista. */
function needsReviewQueue(receipts) {
  return receipts
    .filter((receipt) => receipt.status === 'needs_review')
    .map((receipt) => receipt.id);
}

export default function ReportDetail({ reportId, onBack }) {
  const [report, setReport] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const [meta, setMeta] = useState(EMPTY_META);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // null = lista | id = revisando aquele comprovante
  const [reviewingId, setReviewingId] = useState(null);

  /**
   * Devolve os comprovantes recem-buscados, e nao so os grava no estado.
   * Quem confirma um comprovante precisa decidir o proximo da fila a partir
   * do dado fresco — o `receipts` do estado, lido logo apos um `await`,
   * ainda seria o array de antes da mutacao.
   */
  const load = useCallback(async () => {
    const [reportResponse, receiptsResponse, validationResponse] =
      await Promise.all([
        api.getReport(reportId),
        api.listReceipts(reportId),
        api.getValidation(reportId),
      ]);

    setReport(reportResponse.data);
    setReceipts(receiptsResponse.data);
    setMeta(receiptsResponse.meta);
    setAlerts(validationResponse.data);

    return receiptsResponse.data;
  }, [reportId]);

  useEffect(() => {
    setLoading(true);
    load()
      .then(() => setError(null))
      .catch((caught) =>
        setError({ message: caught.message, action: caught.action }),
      )
      .finally(() => setLoading(false));
  }, [load]);

  // O comprovante em revisao pode sumir da lista entre um poll e outro (por
  // exemplo, deletado em outra aba) — fecha a revisao em vez de quebrar.
  useEffect(() => {
    if (
      reviewingId &&
      !receipts.some((receipt) => receipt.id === reviewingId)
    ) {
      setReviewingId(null);
    }
  }, [reviewingId, receipts]);

  // Poll so enquanto houver comprovante ainda em processamento; para sozinho
  // quando nao ha mais nenhum, para nao ficar batendo a toa.
  useEffect(() => {
    const stillProcessing = receipts.some(
      (receipt) =>
        receipt.status === 'pending' || receipt.status === 'processing',
    );

    if (!stillProcessing) {
      return undefined;
    }

    const timer = setTimeout(() => load().catch(() => {}), POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [receipts, load]);

  /** Recarrega e avanca para o proximo pendente — ou fecha, se a fila esvaziou. */
  async function handleAction() {
    const fresh = await load();
    const queue = needsReviewQueue(fresh);
    setReviewingId(queue.length > 0 ? queue[0] : null);
  }

  /** Prev/anterior dentro da fila, sem mutar nada — usa o estado atual. */
  function handleNavigate(direction) {
    const queue = needsReviewQueue(receipts);

    if (queue.length === 0) {
      setReviewingId(null);
      return;
    }

    const index = queue.indexOf(reviewingId);
    const base = index === -1 ? 0 : index;
    const step = direction === 'next' ? 1 : -1;
    const nextIndex = (base + step + queue.length) % queue.length;

    setReviewingId(queue[nextIndex]);
  }

  if (loading) {
    return <p className="state">Carregando relatorio...</p>;
  }

  if (reviewingId) {
    const receipt = receipts.find((item) => item.id === reviewingId);
    const queue = needsReviewQueue(receipts);
    const queuePosition = queue.indexOf(reviewingId) + 1;

    // O useEffect acima fecha a revisao no proximo render quando isso
    // acontece; ate la, so nao renderiza com um receipt inexistente.
    if (!receipt) {
      return null;
    }

    return (
      <ReceiptReview
        // Forca remontagem ao trocar de comprovante: sem isso, zoom, valores
        // digitados e o estado de carregamento da imagem vazariam de um
        // comprovante para o proximo, porque React reaproveitaria a mesma
        // instancia (mesma posicao na arvore).
        key={receipt.id}
        receipt={receipt}
        alerts={alerts.filter((alert) => alert.receipt_id === reviewingId)}
        queuePosition={queuePosition > 0 ? queuePosition : 1}
        queueTotal={queue.length}
        onNavigate={handleNavigate}
        onBack={() => setReviewingId(null)}
        onAction={handleAction}
      />
    );
  }

  return (
    <>
      <div className="toolbar">
        <button type="button" className="btn" onClick={onBack}>
          Voltar
        </button>
      </div>

      {error && (
        <div className="alert" role="alert">
          <div className="alert__title">{error.message}</div>
          {error.action && <div>{error.action}</div>}
        </div>
      )}

      {report && (
        <div className="form" aria-label="Dados do relatorio">
          <h2 className="form__title">{report.title}</h2>
          <div className="task__meta">
            <span className={`badge badge--${report.status}`}>
              {reportStatusLabel(report.status)}
            </span>
            <span>
              {formatDate(report.period_start)} a{' '}
              {formatDate(report.period_end)}
            </span>
            {report.advance_cents > 0 && (
              <span>Adiantamento: {formatMoney(report.advance_cents)}</span>
            )}
          </div>
        </div>
      )}

      <ReceiptUpload reportId={reportId} onUploaded={load} />
      <ReceiptSummary meta={meta} />
      <ReceiptList receipts={receipts} onOpen={setReviewingId} />
    </>
  );
}
