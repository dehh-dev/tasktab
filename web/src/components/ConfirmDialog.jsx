import { useEffect, useRef } from 'react';

export default function ConfirmDialog({
  title,
  target,
  confirmLabel = 'Confirmar',
  onConfirm,
  onCancel,
  busy,
}) {
  const cancelRef = useRef(null);

  // Escape cancela, e o foco comeca no botao seguro para que um Enter
  // acidental nao confirme a exclusao.
  useEffect(() => {
    cancelRef.current?.focus();

    function handleKeyDown(event) {
      if (event.key === 'Escape' && !busy) {
        onCancel();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, busy]);

  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onCancel();
        }
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <h2 className="dialog__title" id="confirm-title">
          {title}
        </h2>
        <p className="dialog__body">
          Esta acao nao pode ser desfeita.{' '}
          {target && <span className="dialog__target">{target}</span>}
        </p>
        <div className="dialog__actions">
          <button
            type="button"
            className="btn"
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Deletando...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
