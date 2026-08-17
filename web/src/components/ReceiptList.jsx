import {
  categoryLabel,
  formatDate,
  formatMoney,
  receiptStatusLabel,
} from '../constants';

function ReceiptRow({ receipt, onOpen, onDelete, busy }) {
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

      <div className="list-item__actions">
        <button
          type="button"
          className="btn btn--sm btn--danger"
          onClick={() => onDelete(receipt)}
          disabled={busy}
        >
          Deletar
        </button>
      </div>
    </li>
  );
}

export default function ReceiptList({ receipts, onOpen, onDelete, busy }) {
  if (receipts.length === 0) {
    return (
      <p className="state">
        Nenhum comprovante ainda — envie um PDF para comecar.
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
          busy={busy}
        />
      ))}
    </ul>
  );
}
