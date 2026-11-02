import { useCallback, useEffect, useState } from 'react';
import { Copy, Download } from 'lucide-react';
import * as api from '../../api';
import { formatDate, formatMoney } from '../../constants';
import { ErrorAlert, toError } from './common';

/**
 * Copia o texto; com `html`, copia as duas formas, e o Gmail cola a versao
 * com o negrito vermelho. Sem permissao de area de transferencia, avisa.
 */
async function copy(text, html) {
  if (html && window.ClipboardItem) {
    await navigator.clipboard.write([
      new window.ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      }),
    ]);
    return;
  }
  await navigator.clipboard.writeText(text);
}

function CopyField({ id, label, value, html, multiline }) {
  const [copied, setCopied] = useState(null);

  async function handle() {
    try {
      await copy(value, html);
      setCopied('Copiado.');
    } catch {
      setCopied('Nao deu para copiar: selecione e copie a mao.');
    }
  }

  return (
    <div className="field field--full">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="rpa-copy">
        {multiline ? (
          <textarea
            id={id}
            className="field__input"
            readOnly
            rows={9}
            value={value}
          />
        ) : (
          <input id={id} className="field__input" readOnly value={value} />
        )}
        <button
          type="button"
          className="btn btn--sm"
          onClick={handle}
          aria-label={`Copiar ${label.toLowerCase()}`}
        >
          <Copy size={14} aria-hidden="true" />
          Copiar
        </button>
      </div>
      {copied && (
        <span className="field__hint" role="status">
          {copied}
        </span>
      )}
    </div>
  );
}

/** Link de download que mantem o nome do servidor (com acento e o "1ª"). */
function DownloadLink({ href, children }) {
  return (
    <a className="btn btn--sm" href={href} download>
      <Download size={14} aria-hidden="true" />
      {children}
    </a>
  );
}

/**
 * Emissao: os RPAs do n-esimo pagamento (um PDF por pessoa, ou o .zip), o
 * texto do e-mail de solicitacao para colar no Gmail e os documentos da
 * equipe. O tasktab nao envia nada.
 */
export default function EmissionTab({ launch }) {
  const [payments, setPayments] = useState(null);
  const [number, setNumber] = useState(null);
  const [email, setEmail] = useState(null);
  const [assigned, setAssigned] = useState(0);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [response, documents] = await Promise.all([
        api.listPayments(launch.id),
        api.listDocuments(launch.id),
      ]);
      setAssigned(
        documents.data.filter((document) => document.worker_id).length,
      );
      const valid = response.data.filter(
        (payment) => payment.status !== 'canceled',
      );
      setPayments(valid);
      const numbers = [...new Set(valid.map((payment) => payment.number))];
      setNumber((current) => current ?? numbers.at(-1) ?? null);
    } catch (caught) {
      setError(toError(caught));
    }
  }, [launch.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!number) return;
    setEmail(null);
    api
      .getRequestEmail(launch.id, number)
      .then((response) => setEmail(response.data))
      .catch((caught) => setError(toError(caught)));
  }, [launch.id, number]);

  if (!payments) {
    return <p className="state">Carregando...</p>;
  }

  const numbers = [...new Set(payments.map((payment) => payment.number))];
  const current = payments.filter((payment) => payment.number === number);

  return (
    <section aria-labelledby="emission-title" className="rpa-section">
      <h3 id="emission-title" className="rpa-section__title">
        Emissao
      </h3>
      <ErrorAlert error={error} />

      {numbers.length === 0 ? (
        <p className="state">
          Nenhum RPA emitido ainda: emita na aba Pagamentos.
        </p>
      ) : (
        <>
          <div className="filter" role="group" aria-label="Pagamento">
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

          {launch.purged_at ? (
            <p className="state">
              O PDF dos RPAs nao e mais gerado: a retencao apagou conta,
              endereco e PIS da equipe.
            </p>
          ) : (
            <div className="toolbar">
              <DownloadLink href={api.rpasZipUrl(launch.id, number)}>
                RPAs do {number}º pagamento (.zip)
              </DownloadLink>
            </div>
          )}

          <ul className="list" aria-label={`RPAs do ${number}º pagamento`}>
            {current.map((payment) => (
              <li key={payment.id} className="list-item">
                <div className="list-item__main">
                  <span className="list-item__title">
                    {payment.worker_number}. {payment.worker_name}
                  </span>
                  <div className="list-item__meta">
                    <span>{payment.code}</span>
                    <span>Liquido {formatMoney(payment.net_cents)}</span>
                    <span>Pagamento {formatDate(payment.payment_date)}</span>
                  </div>
                </div>
                {!launch.purged_at && (
                  <div className="list-item__actions">
                    <DownloadLink href={api.rpaPdfUrl(payment.id)}>
                      PDF
                    </DownloadLink>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <section aria-labelledby="email-title" className="rpa-subsection">
            <h4 id="email-title">E-mail de solicitacao</h4>
            {!email ? (
              <p className="state">Montando o e-mail...</p>
            ) : (
              <div className="form__grid">
                {email.reply && (
                  <p className="field__hint field--full">
                    Do 2º pagamento em diante, responda na mesma conversa do
                    Gmail.
                  </p>
                )}
                <CopyField
                  id="email-subject"
                  label="Assunto"
                  value={email.subject}
                />
                <CopyField
                  id="email-to"
                  label="Para"
                  value={email.to.join(', ')}
                />
                <CopyField
                  id="email-cc"
                  label="Copia"
                  value={email.cc.join(', ')}
                />
                <CopyField
                  id="email-body"
                  label="Texto"
                  value={email.text}
                  html={email.html}
                  multiline
                />
              </div>
            )}
          </section>
        </>
      )}

      <section
        aria-labelledby="emission-documents-title"
        className="rpa-subsection"
      >
        <h4 id="emission-documents-title">Documentos da equipe</h4>
        <p className="field__hint">
          Uma pasta por pessoa. A versao para e-mail reduz as fotos para caber
          nos 25 MB do Gmail.
        </p>
        {assigned === 0 ? (
          <p className="state">
            Nenhum documento com pessoa: envie o .zip do Drive na aba
            Documentos.
          </p>
        ) : (
          <div className="toolbar__group">
            <DownloadLink href={api.documentsZipUrl(launch.id)}>
              Documentos (.zip)
            </DownloadLink>
            <DownloadLink
              href={api.documentsZipUrl(launch.id, { email: true })}
            >
              Documentos para e-mail (.zip)
            </DownloadLink>
          </div>
        )}
      </section>
    </section>
  );
}
