import { useEffect, useState } from 'react';
import * as api from '../../api';
import { formatDate, formatMoney } from '../../constants';
import Widget, { WidgetStat } from '../../shell/Widget';

/**
 * RPA no Inicio: o proximo pagamento (data, pessoas, liquido) e o que esta
 * pendente — quem ainda nao teve RPA e o RPA cuja data passou sem o recibo
 * assinado. Tudo escrito, nao so contado.
 */
export default function RpaHomeWidget({ module, onOpen }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let current = true;
    api
      .getRpaSummary()
      .then((response) => current && setSummary(response.data))
      .catch((caught) => current && setError(caught.message));
    return () => {
      current = false;
    };
  }, []);

  const next = summary?.next_payment;

  return (
    <Widget module={module} onOpen={onOpen}>
      {error && <p className="widget__empty">{error}</p>}
      {!error && !summary && <p className="widget__empty">Carregando...</p>}
      {summary && (
        <>
          <dl className="widget__stats">
            <WidgetStat
              label="Lancamentos abertos"
              value={summary.open_launches}
            />
            <WidgetStat label="Sem RPA ainda" value={summary.without_payment} />
            <WidgetStat
              label="Recibo nao devolvido"
              value={summary.awaiting_receipt}
            />
          </dl>
          {next ? (
            <p className="widget__item-meta">
              Proximo pagamento em {formatDate(next.payment_date)}:{' '}
              {next.people} {next.people === 1 ? 'pessoa' : 'pessoas'},{' '}
              {formatMoney(next.net_cents)} liquido.
            </p>
          ) : (
            <p className="widget__empty">Nenhum pagamento emitido por vir.</p>
          )}
          {summary.awaiting_receipt > 0 && (
            <p className="widget__item-meta">
              Pendente: {summary.awaiting_receipt} RPA(s) com a data passada e
              sem recibo assinado.
            </p>
          )}
          {summary.without_payment > 0 && (
            <p className="widget__item-meta">
              Pendente: {summary.without_payment} pessoa(s) na equipe sem nenhum
              RPA emitido.
            </p>
          )}
        </>
      )}
    </Widget>
  );
}
