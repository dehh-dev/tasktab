import { useCallback, useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import * as api from '../../api';
import {
  BATCH_STATUSES,
  formatDate,
  formatMoney,
  labelOf,
} from '../../constants';
import { ErrorAlert, FileDrop, toError } from './common';

/** O que a leitura dos recibos achou, escrito: quem casou, quem faltou e o que difere. */
function BatchResult({ result }) {
  return (
    <div className="rpa-subsection">
      <h4>Resultado da leitura</h4>
      <ul className="rpa-details" aria-label="Recibos que casaram">
        {result.matched.map((entry) => (
          <li key={entry.page}>
            Pagina {entry.page}: {entry.worker_number}. {entry.worker_name} (
            {entry.code}), casou pelo {entry.by === 'cpf' ? 'CPF' : 'nome'}
          </li>
        ))}
      </ul>
      {result.missing.length > 0 && (
        <div className="alert" data-level="pendente" role="status">
          <div className="alert__title">
            Faltou recibo de {result.missing.length} pessoa(s)
          </div>
          <ul className="rpa-details">
            {result.missing.map((entry) => (
              <li key={entry.payment_id}>
                Sem recibo: {entry.worker_number}. {entry.worker_name} (
                {entry.code})
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.unmatched_pages.length > 0 && (
        <div className="alert" data-level="pendente" role="status">
          <div className="alert__title">Pagina sem pessoa</div>
          <ul className="rpa-details">
            {result.unmatched_pages.map((entry) => (
              <li key={entry.page}>
                Pagina {entry.page}: {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(result.name_differences.length > 0 ||
        result.value_differences.length > 0 ||
        result.date_differences.length > 0) && (
        <div className="alert" data-level="decisao" role="status">
          <div className="alert__title">
            Diferencas apontadas (nada foi corrigido)
          </div>
          <ul className="rpa-details">
            {result.name_differences.map((entry) => (
              <li key={`n-${entry.page}`}>
                Nome diferente na pagina {entry.page}: "{entry.name_read}" no
                recibo, "{entry.worker_name}" no cadastro
              </li>
            ))}
            {result.value_differences.map((entry) => (
              <li key={`v-${entry.page}`}>
                Valor diferente na pagina {entry.page} ({entry.worker_name}):{' '}
                {formatMoney(entry.net_read_cents)} no recibo,{' '}
                {formatMoney(entry.net_cents)} no RPA
              </li>
            ))}
            {result.date_differences.map((entry) => (
              <li key={`d-${entry.page}`}>
                Data diferente na pagina {entry.page} ({entry.worker_name}):{' '}
                {formatDate(entry.date_read)} no recibo,{' '}
                {formatDate(entry.payment_date)} no RPA
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Recibos: o PDF escaneado que o financeiro devolve. A leitura roda no
 * servidor (OCR); a tela consulta o envio ate ele terminar, com espera
 * crescente, e mostra o resultado. Os pagamentos casados viram pagos.
 */
export default function ReceiptsTab({ launch, canWrite }) {
  const [numbers, setNumbers] = useState([]);
  const [paidNumbers, setPaidNumbers] = useState([]);
  const [number, setNumber] = useState(null);
  const [batch, setBatch] = useState(null);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    api
      .listPayments(launch.id)
      .then((response) => {
        const found = [
          ...new Set(
            response.data
              .filter((p) => p.status !== 'canceled')
              .map((p) => p.number),
          ),
        ];
        setNumbers(found);
        setPaidNumbers(
          response.data.filter((p) => p.status === 'paid').map((p) => p.number),
        );
        setNumber((current) => current ?? found.at(-1) ?? null);
      })
      .catch((caught) => setError(toError(caught)));
    return () => clearTimeout(timer.current);
  }, [launch.id]);

  const follow = useCallback((id, delay = 1000) => {
    timer.current = setTimeout(async () => {
      try {
        const response = await api.getReceiptBatch(id);
        setBatch(response.data);
        if (['pending', 'processing'].includes(response.data.status)) {
          follow(id, Math.min(delay * 1.5, 5000));
        }
      } catch (caught) {
        setError(toError(caught));
        follow(id, Math.min(delay * 2, 10000));
      }
    }, delay);
  }, []);

  async function upload(file) {
    setSending(true);
    setError(null);
    setBatch(null);
    try {
      const response = await api.uploadSignedReceipts(launch.id, number, file);
      setBatch(response.data);
      follow(response.data.id);
    } catch (caught) {
      setError(toError(caught));
    } finally {
      setSending(false);
    }
  }

  return (
    <section aria-labelledby="receipts-title" className="rpa-section">
      <h3 id="receipts-title" className="rpa-section__title">
        Recibos
      </h3>
      <ErrorAlert error={error} />

      {numbers.length === 0 ? (
        <p className="state">Nenhum RPA emitido ainda.</p>
      ) : (
        <>
          <div
            className="filter"
            role="group"
            aria-label="Pagamento dos recibos"
          >
            {numbers.map((value) => (
              <button
                key={value}
                type="button"
                className="filter__option"
                aria-pressed={value === number}
                onClick={() => setNumber(value)}
              >
                {value}º pagamento
              </button>
            ))}
          </div>

          {canWrite && (
            <FileDrop
              label={`Arraste o PDF dos recibos assinados do ${number}º pagamento, ou clique para escolher`}
              accept="application/pdf"
              disabled={sending}
              onFile={upload}
            />
          )}

          {batch && (
            <p className="state" role="status">
              Envio {batch.id}: {labelOf(BATCH_STATUSES, batch.status)}
              {batch.status === 'failed' && ` — ${batch.error}`}
              {['pending', 'processing'].includes(batch.status) &&
                ` (${batch.page_count} pagina(s))`}
            </p>
          )}
          {batch?.status === 'done' && <BatchResult result={batch.result} />}

          {/* Sem recibo lido, o .zip seria o JSON do 422 salvo como arquivo. */}
          {(paidNumbers.includes(number) || batch?.status === 'done') && (
            <a
              className="btn btn--sm"
              href={api.receiptsZipUrl(launch.id, number)}
              download
            >
              <Download size={14} aria-hidden="true" />
              Recibos do {number}º pagamento (.zip)
            </a>
          )}
        </>
      )}
    </section>
  );
}
