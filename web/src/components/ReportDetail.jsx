import { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import ReceiptUpload from './ReceiptUpload';
import ReceiptSummary from './ReceiptSummary';
import ReceiptList from './ReceiptList';
import { formatDate, formatMoney, reportStatusLabel } from '../constants';

const POLL_INTERVAL_MS = 1500;
const EMPTY_META = { total: 0, total_cents: 0, by_category: {} };

export default function ReportDetail({ reportId, onBack }) {
  const [report, setReport] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const [meta, setMeta] = useState(EMPTY_META);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [reportResponse, receiptsResponse] = await Promise.all([
        api.getReport(reportId),
        api.listReceipts(reportId),
      ]);
      setReport(reportResponse.data);
      setReceipts(receiptsResponse.data);
      setMeta(receiptsResponse.meta);
      setError(null);
    } catch (caught) {
      setError({ message: caught.message, action: caught.action });
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    load();
  }, [load]);

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

    const timer = setTimeout(load, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [receipts, load]);

  if (loading) {
    return <p className="state">Carregando relatorio...</p>;
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
      <ReceiptList receipts={receipts} />
    </>
  );
}
