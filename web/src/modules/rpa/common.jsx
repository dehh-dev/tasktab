import { useState } from 'react';
import { Upload } from 'lucide-react';

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
 * O servidor confere o conteudo: nada e filtrado por extensao aqui.
 */
export function FileDrop({ label, accept, disabled, onFile }) {
  const [active, setActive] = useState(false);

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
        if (event.dataTransfer.files[0]) onFile(event.dataTransfer.files[0]);
      }}
    >
      <input
        type="file"
        className="sr-only"
        accept={accept}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          if (event.target.files[0]) onFile(event.target.files[0]);
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
