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
 * Os sem pessoa, por conta Google: a escolha vale para todos os arquivos da
 * conta (issue 59). Sem o nome da conta, so arquivo por arquivo, na tabela.
 */
function accountsWithoutWorker(documents) {
  const byAccount = new Map();

  for (const document of documents) {
    if (document.worker_id || !document.source_name) continue;
    if (!byAccount.has(document.source_name)) {
      byAccount.set(document.source_name, []);
    }
    byAccount.get(document.source_name).push(document);
  }

  return [...byAccount]
    .map(([account, files]) => ({ account, files }))
    .sort((a, b) => a.account.localeCompare(b.account));
}

/**
 * Documentos do formulario: o .zip da pasta de respostas do Drive entra, e
 * cada arquivo vai para a pessoa e o tipo. So o nome completo da conta Google
 * liga sozinho; o resto fica agrupado pela conta, para escolher a pessoa uma
 * vez, e no fim da tabela, para corrigir um arquivo so.
 */
export default function DocumentsTab({ launch, canWrite }) {
  const [documents, setDocuments] = useState(null);
  const [workers, setWorkers] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [assigning, setAssigning] = useState(null);

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

  async function assignAccount(account, workerId) {
    if (!workerId) return;
    setAssigning(account);
    setError(null);
    try {
      const updated = new Map();
      for (const document of documents) {
        if (document.worker_id || document.source_name !== account) continue;
        const response = await api.updateDocument(document.id, {
          worker_id: Number(workerId),
        });
        updated.set(document.id, response.data);
      }
      setDocuments((current) => current.map((d) => updated.get(d.id) ?? d));
    } catch (caught) {
      setError(toError(caught));
      // Parte pode ter ido: a lista volta do servidor como ficou.
      await load();
    } finally {
      setAssigning(null);
    }
  }

  const unassigned = (documents ?? []).filter(
    (document) => !document.worker_id,
  ).length;
  const accounts = accountsWithoutWorker(documents ?? []);

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
          {canWrite && accounts.length > 0 && (
            <section
              aria-labelledby="accounts-title"
              className="rpa-subsection"
            >
              <h4 id="accounts-title">Sem pessoa, por conta</h4>
              <p className="filter__count">
                So o nome completo da conta liga sozinho. Escolha a pessoa uma
                vez: vale para todos os arquivos da conta.
              </p>
              <ul className="rpa-issues" aria-label="Contas sem pessoa">
                {accounts.map(({ account, files }) => (
                  <li key={account}>
                    <span>
                      Conta "{account}": {files.length} arquivo(s)
                    </span>
                    <select
                      className="field__input"
                      aria-label={`Pessoa da conta ${account}`}
                      value=""
                      disabled={assigning !== null}
                      onChange={(event) =>
                        assignAccount(account, event.target.value)
                      }
                    >
                      <option value="">
                        {assigning === account
                          ? 'Atribuindo...'
                          : 'Escolher a pessoa'}
                      </option>
                      {workers.map((worker) => (
                        <option key={worker.id} value={worker.id}>
                          {worker.number}. {worker.name}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </section>
          )}
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
