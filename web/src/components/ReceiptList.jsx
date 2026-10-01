import {
  categoryLabel,
  formatDate,
  formatMoney,
  receiptStatusLabel,
} from '../constants';

// Onde reprocessar faz sentido: a pagina que falhou, e a que ficou presa na
// fila — a fila vive na memoria do processo, e um reinicio no meio do lote
// deixa linhas em `pending`/`processing` para sempre. Sem este botao a unica
// saida era `curl`.
const REPROCESSABLE = new Set(['failed', 'pending', 'processing']);

function ReceiptRow({ receipt, onOpen, onDelete, onReprocess, busy }) {
  const issuedAt = formatDate(receipt.issued_at);

  return (
    <li className="list-item">
      <div className="list-item__main">
        <button
          type="button"
          className="link-button"
          onClick={() => onOpen(receipt.id)}
        >
          {receipt.merchant_name || `Comprovante #${receipt.id}`}
        </button>
        <div className="list-item__meta">
          <span className={`badge badge--${receipt.status}`}>
            {receiptStatusLabel(receipt.status)}
          </span>
          <span>{categoryLabel(receipt.category)}</span>
          {issuedAt && <span>{issuedAt}</span>}
          {receipt.amount_cents !== null && (
            <span>{formatMoney(receipt.amount_cents)}</span>
          )}
        </div>
      </div>

      {
        // Sem `onDelete` a sessao so le o relatorio (auditor), e a linha sai
        // sem acoes — o mesmo contrato da TaskList.
        onDelete && (
          <div className="list-item__actions">
            {onReprocess && REPROCESSABLE.has(receipt.status) && (
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => onReprocess(receipt)}
                disabled={busy}
              >
                Reprocessar
              </button>
            )}
            <button
              type="button"
              className="btn btn--sm btn--danger"
              onClick={() => onDelete(receipt)}
              disabled={busy}
            >
              Deletar
            </button>
          </div>
        )
      }
    </li>
  );
}

export default function ReceiptList({
  receipts,
  onOpen,
  onDelete,
  onReprocess,
  busy,
}) {
  if (receipts.length === 0) {
    // Mandar enviar um PDF a quem so le o relatorio seria oferecer o que a
    // API vai recusar.
    return (
      <p className="state">
        {onDelete
          ? 'Nenhum comprovante ainda — envie um PDF para comecar.'
          : 'Nenhum comprovante ainda.'}
      </p>
    );
  }

  return (
    <ul className="list">
      {receipts.map((receipt) => (
        <ReceiptRow
          key={receipt.id}
          receipt={receipt}
          onOpen={onOpen}
          onDelete={onDelete}
          onReprocess={onReprocess}
          busy={busy}
        />
      ))}
    </ul>
  );
}
