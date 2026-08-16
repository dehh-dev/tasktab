import {
  categoryLabel,
  formatDate,
  formatMoney,
  receiptStatusLabel,
} from '../constants';

function ReceiptRow({ receipt }) {
  const issuedAt = formatDate(receipt.issued_at);

  return (
    <li className="list-item">
      <div className="list-item__main">
        <div className="list-item__title">
          {receipt.merchant_name || `Comprovante #${receipt.id}`}
        </div>
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
    </li>
  );
}

export default function ReceiptList({ receipts }) {
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
        <ReceiptRow key={receipt.id} receipt={receipt} />
      ))}
    </ul>
  );
}
