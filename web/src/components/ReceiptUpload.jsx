import { useState } from 'react';
import * as api from '../api';

/**
 * Arrastar-e-soltar com fallback de selecao por clique — o `<input>` fica
 * dentro do `<label>`, entao clicar ou apertar Enter/Espaco nele abre o
 * seletor de arquivos, sem JS extra para isso.
 *
 * Nao filtra por extensao no cliente: o servidor confere os magic bytes do
 * PDF e ja devolve mensagem clara para quem manda o arquivo errado — filtrar
 * aqui so duplicaria a regra e esconderia esse erro especifico.
 */
export default function ReceiptUpload({ reportId, onUploaded }) {
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState(null);

  async function submitFiles(fileList) {
    const files = Array.from(fileList);

    if (files.length === 0) {
      return;
    }

    setUploading(true);
    setError(null);

    try {
      await api.uploadReceipts(reportId, files);
      await onUploaded();
    } catch (caught) {
      setError({ message: caught.message, action: caught.action });
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragActive(false);
    submitFiles(event.dataTransfer.files);
  }

  return (
    <div className="upload">
      <label
        className={`dropzone${dragActive ? ' dropzone--active' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        <input
          type="file"
          className="sr-only"
          multiple
          accept="application/pdf"
          disabled={uploading}
          onChange={(event) => submitFiles(event.target.files)}
        />
        <span className="dropzone__text">
          {uploading
            ? 'Enviando...'
            : 'Arraste PDFs aqui ou clique para selecionar'}
        </span>
      </label>

      {error && (
        <div className="alert" role="alert">
          <div className="alert__title">{error.message}</div>
          {error.action && <div>{error.action}</div>}
        </div>
      )}
    </div>
  );
}
