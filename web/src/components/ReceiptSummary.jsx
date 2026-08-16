import { categoryLabel, formatMoney } from '../constants';

export default function ReceiptSummary({ meta }) {
  const categories = Object.entries(meta.by_category || {}).sort(
    ([, a], [, b]) => b - a,
  );

  return (
    <div className="summary">
      <div className="summary__item">
        <span className="summary__label">Total</span>
        <span className="summary__value">{formatMoney(meta.total_cents)}</span>
      </div>

      {categories.map(([category, cents]) => (
        <div className="summary__item" key={category}>
          <span className="summary__label">{categoryLabel(category)}</span>
          <span className="summary__value">{formatMoney(cents)}</span>
        </div>
      ))}
    </div>
  );
}
