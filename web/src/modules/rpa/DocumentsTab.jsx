import { useCallback, useEffect, useState } from 'react';
import * as api from '../../api';
import { DOCUMENT_KINDS, DOCUMENT_SIDES, labelOf } from '../../constants';
import { ErrorAlert, FileDrop, toError } from './common';

function size(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
    : `${Math.ceil(bytes / 1024)} KB`;
}

/**
 * Documentos do formulario: o .zip da pasta de respostas do Drive entra, e
 * cada arquivo vai para a pessoa e o tipo. O que nao casou com ninguem fica
 * no fim, com o nome da conta Google, para escolher a pessoa.
 */
export default function DocumentsTab({ launch, canWrite }) {
  const [documents, setDocuments] = useState(null);
  const [workers, setWorkers] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, team] = await Promise.all([
        api.listDocuments(launch.id),
        api.listWorkers(launch.id),
      ]);
      setDocuments(list.data);
      setWorkers(team.data);
    } catch (caught) {
      setError(toError(caught));
    }
  }, [launch.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function upload(file) {
    setSending(true);
    setError(null);
    try {
      const response = await api.uploadDocuments(launch.id, file);
      setResult(response.data);
      setDocuments(response.data.documents);
    } catch (caught) {
      setError(toError(caught));
    } finally {
      setSending(false);
    }
  }

  async function assign(document, workerId) {
    try {
      const response = await api.updateDocument(document.id, {
        worker_id: workerId ? Number(workerId) : null,
      });
      setDocuments((current) =>
        current.map((d) => (d.id === document.id ? response.data : d)),
      );
    } catch (caught) {
      setError(toError(caught));
    }
  }

  const unassigned = (documents ?? []).filter(
    (document) => !document.worker_id,
  ).length;

  return (
    <section aria-labelledby="documents-title" className="rpa-section">
      <h3 id="documents-title" className="rpa-section__title">
        Documentos
      </h3>

      {canWrite && (
        <FileDrop
          label="Arraste o .zip da pasta de respostas baixado do Drive, ou clique para escolher"
          accept=".zip,application/zip"
          disabled={sending}
          onFile={upload}
        />
      )}
      <ErrorAlert error={error} />

      {result && (
        <div className="alert" data-level="informativo" role="status">
          <div className="alert__title">
            {result.stored} arquivo(s) lido(s), {result.created} novo(s)
            {result.repeated > 0 &&
              `, ${result.repeated} repetido(s) (frente igual ao verso)`}
            .
          </div>
          {result.rejected.length > 0 && (
            <ul className="rpa-details">
              {result.rejected.map((entry) => (
                <li key={entry.name}>
                  Recusado: {entry.name} — {entry.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {documents === null ? (
        <p className="state">Carregando documentos...</p>
      ) : documents.length === 0 ? (
        <p className="state">Nenhum documento ainda.</p>
      ) : (
        <>
          <p className="filter__count" aria-live="polite">
            {documents.length} documento(s), {unassigned} sem pessoa
          </p>
          <div className="rpa-grid-scroll">
            <table className="rpa-table">
              <caption className="sr-only">Documentos da equipe</caption>
              <thead>
                <tr>
                  <th scope="col">Pessoa</th>
                  <th scope="col">Documento</th>
                  <th scope="col">Arquivo</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => (
                  <tr key={document.id}>
                    <td>
                      {canWrite ? (
                        <select
                          className="field__input"
                          aria-label={`Pessoa do documento ${document.id}`}
                          value={document.worker_id ?? ''}
                          onChange={(event) =>
                            assign(document, event.target.value)
                          }
                        >
                          <option value="">Sem pessoa</option>
                          {workers.map((worker) => (
                            <option key={worker.id} value={worker.id}>
                              {worker.number}. {worker.name}
                            </option>
                          ))}
                        </select>
                      ) : document.worker_id ? (
                        `${document.worker_number}. ${document.worker_name}`
                      ) : (
                        'Sem pessoa'
                      )}
                      {!document.worker_id && (
                        <div className="rpa-flag">
                          sem pessoa: conta "
                          {document.source_name ?? 'desconhecida'}"
                        </div>
                      )}
                    </td>
                    <td>
                      {labelOf(DOCUMENT_KINDS, document.kind)}
                      {document.side
                        ? ` (${labelOf(DOCUMENT_SIDES, document.side).toLowerCase()})`
                        : ''}
                    </td>
                    <td>
                      {document.content_type === 'application/pdf'
                        ? 'PDF'
                        : 'Foto'}
                      , {size(document.byte_size)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
