import { useLayoutEffect, useRef } from 'react';

export default function ConfirmDialog({
  title,
  target,
  confirmLabel = 'Confirmar',
  onConfirm,
  onCancel,
  busy,
}) {
  const dialogRef = useRef(null);

  // A tag <dialog> com showModal() entrega de graca o que uma div nunca teve:
  // foco preso dentro do dialogo, Escape nativo e devolucao do foco ao
  // elemento que abriu. Antes, `aria-modal` prometia um isolamento que nao
  // existia — o Tab passeava pela pagina atras.
  // useLayoutEffect, e nao useEffect: a limpeza precisa rodar antes do React
  // arrancar o <dialog> do DOM. Um close() em no ja removido nao devolve o
  // foco a quem abriu.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog.open) {
      dialog.showModal();
    }

    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, []);

  // O evento `cancel` cobre o Escape. Bloquear enquanto `busy` evita fechar
  // no meio de uma exclusao ja em curso.
  function handleCancel(event) {
    event.preventDefault();

    if (!busy) {
      onCancel();
    }
  }

  // Clique no backdrop chega com o proprio <dialog> como alvo, ja que a caixa
  // visivel e um filho.
  function handleClick(event) {
    if (event.target === dialogRef.current && !busy) {
      onCancel();
    }
  }

  return (
    <dialog
      className="dialog"
      ref={dialogRef}
      aria-labelledby="confirm-title"
      onCancel={handleCancel}
      onClick={handleClick}
    >
      <div className="dialog__box">
        <h2 className="dialog__title" id="confirm-title">
          {title}
        </h2>
        <p className="dialog__body">
          Esta acao nao pode ser desfeita.{' '}
          {target && <span className="dialog__target">{target}</span>}
        </p>
        <div className="dialog__actions">
          {/* autoFocus no botao seguro: um Enter acidental nao pode deletar. */}
          <button
            type="button"
            className="btn"
            autoFocus
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
    </dialog>
  );
}
