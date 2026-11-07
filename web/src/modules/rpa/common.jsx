import { useState } from 'react';
import { Upload } from 'lucide-react';
import { formatMoney, formatSubcents } from '../../constants';

/** O erro da API como o resto da interface o mostra: mensagem e o que fazer. */
export function ErrorAlert({ error }) {
  if (!error) {
    return null;
  }

  return (
    <div className="alert" role="alert">
      <div className="alert__title">{error.message}</div>
      {error.action && <div>{error.action}</div>}
      {error.details?.length > 0 && (
        <ul className="rpa-details">
          {error.details.map((detail, index) => (
            <li key={`${detail.field}-${index}`}>
              {detail.field}: {detail.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** O erro capturado, com os detalhes por campo que a API devolve no 422. */
export function toError(caught) {
  return {
    message: caught.message,
    action: caught.action,
    details: caught.details ?? [],
  };
}

/**
 * Envio de um arquivo, clicando ou arrastando, como o upload de comprovante.
 * O servidor confere o conteudo: nada e filtrado por extensao aqui. Com
 * `multiple`, `onFile` recebe a lista dos arquivos.
 */
export function FileDrop({ label, accept, disabled, multiple, onFile }) {
  const [active, setActive] = useState(false);
  const deliver = (files) => {
    if (files.length === 0) return;
    onFile(multiple ? [...files] : files[0]);
  };

  return (
    <label
      className={`dropzone${active ? ' dropzone--active' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setActive(true);
      }}
      onDragLeave={() => setActive(false)}
      onDrop={(event) => {
        event.preventDefault();
        setActive(false);
        deliver(event.dataTransfer.files);
      }}
    >
      <input
        type="file"
        className="sr-only"
        accept={accept}
        disabled={disabled}
        multiple={multiple}
        aria-label={label}
        onChange={(event) => {
          deliver(event.target.files);
          event.target.value = '';
        }}
      />
      <Upload className="dropzone__icon" size={20} aria-hidden="true" />
      <span className="dropzone__text">{disabled ? 'Enviando...' : label}</span>
    </label>
  );
}

/** Um campo de formulario com rotulo e o erro do servidor embaixo. */
export function Field({ id, label, error, full, hint, children }) {
  return (
    <div className={`field${full ? ' field--full' : ''}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
      {error && (
        <span className="field__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * O saldo pendente de cada pessoa (issue 60): o que falta pagar ou descontar
 * dos dias ja pagos. Escrito por extenso, nao so o sinal do valor.
 */
export function BalanceList({ balances, label }) {
  return (
    <ul className="rpa-details" aria-label={label}>
      {balances.map((balance) => {
        const parts = [
          balance.extra_subcents !== 0 &&
            `extra adiado ${formatSubcents(balance.extra_subcents)}`,
          balance.correction_subcents !== 0 &&
            `correcao ${formatSubcents(balance.correction_subcents)}`,
        ].filter(Boolean);

        return (
          <li key={balance.worker_id}>
            {balance.worker_number}. {balance.worker_name}:{' '}
            {formatMoney(Math.abs(balance.value_cents))}{' '}
            {balance.value_cents > 0 ? 'a pagar' : 'a descontar'} (
            {parts.join('; ')})
          </li>
        );
      })}
    </ul>
  );
}
