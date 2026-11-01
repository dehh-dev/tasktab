import { useCallback, useEffect, useState } from 'react';
import * as api from '../../api';
import { formatDate } from '../../constants';
import { ErrorAlert, FileDrop, Field, toError } from './common';

function formatCpf(cpf) {
  return cpf?.length === 11
    ? cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
    : cpf;
}

const open = (issues) => issues.filter((issue) => !issue.resolved);

/** O que a importacao fez, em numeros e linhas. Nada de nome nem CPF aqui. */
function ImportResult({ result }) {
  return (
    <div className="alert" data-level="informativo" role="status">
      <div className="alert__title">
        Importacao: {result.created} nova(s), {result.updated} atualizada(s),{' '}
        {result.unchanged} sem mudanca.
      </div>
      {result.rejected.length > 0 && (
        <ul className="rpa-details">
          {result.rejected.map((entry) => (
            <li key={`r-${entry.line}`}>
              Linha {entry.line} recusada: {entry.reason}
            </li>
          ))}
        </ul>
      )}
      {result.warnings.length > 0 && (
        <ul className="rpa-details">
          {result.warnings.map((warning, index) => (
            <li key={`w-${index}`}>
              {warning.column
                ? `Pergunta "${warning.column.replace(/\s+/g, ' ').trim()}": `
                : ''}
              {warning.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WorkerEditor({ worker, onSaved, onCancel }) {
  const [values, setValues] = useState({
    role: worker.role ?? '',
    starts_on: worker.starts_on ?? '',
    left_on: worker.left_on ?? '',
    promoted_since: worker.promoted_since ?? '',
    dependents: String(worker.dependents ?? 0),
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const errors = Object.fromEntries(
    (error?.details ?? []).map((d) => [d.field, d.message]),
  );
  const set = (field) => (event) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await api.updateWorker(worker.id, {
        role: values.role.trim() || null,
        starts_on: values.starts_on || null,
        left_on: values.left_on || null,
        promoted_since: values.promoted_since || null,
        dependents: Number(values.dependents) || 0,
      });
      onSaved(response.data);
    } catch (caught) {
      setError(toError(caught));
    } finally {
      setSaving(false);
    }
  }

  const id = (field) => `worker-${worker.id}-${field}`;

  return (
    <form className="form rpa-inline-form" onSubmit={save} noValidate>
      <div className="form__grid">
        <Field id={id('role')} label="Funcao" error={errors.role}>
          <input
            id={id('role')}
            className="field__input"
            value={values.role}
            onChange={set('role')}
          />
        </Field>
        <Field id={id('start')} label="Inicio real" error={errors.starts_on}>
          <input
            id={id('start')}
            type="date"
            className="field__input"
            value={values.starts_on}
            onChange={set('starts_on')}
          />
        </Field>
        <Field
          id={id('left')}
          label="Saida (ultimo dia)"
          error={errors.left_on}
        >
          <input
            id={id('left')}
            type="date"
            className="field__input"
            value={values.left_on}
            onChange={set('left_on')}
          />
        </Field>
        <Field
          id={id('promoted')}
          label="Promovido desde"
          error={errors.promoted_since}
        >
          <input
            id={id('promoted')}
            type="date"
            className="field__input"
            value={values.promoted_since}
            onChange={set('promoted_since')}
          />
        </Field>
        <Field
          id={id('dependents')}
          label="Dependentes (IRRF)"
          error={errors.dependents}
        >
          <input
            id={id('dependents')}
            type="number"
            min="0"
            className="field__input"
            value={values.dependents}
            onChange={set('dependents')}
          />
        </Field>
      </div>
      <ErrorAlert
        error={error && Object.keys(errors).length === 0 ? error : null}
      />
      <div className="form__actions">
        <button
          type="button"
          className="btn"
          onClick={onCancel}
          disabled={saving}
        >
          Cancelar
        </button>
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? 'Salvando...' : 'Salvar pessoa'}
        </button>
      </div>
    </form>
  );
}

/**
 * Equipe: a importacao das respostas do formulario e cada pessoa com as
 * pendencias escritas — "CPF invalido", e nao so uma cor. Corrigir o campo
 * tira a pendencia; o que nao precisa mexer se da por resolvido.
 */
export default function TeamTab({ launch, canWrite }) {
  const [workers, setWorkers] = useState(null);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [editingId, setEditingId] = useState(null);

  const load = useCallback(async () => {
    try {
      const response = await api.listWorkers(launch.id);
      setWorkers(response.data);
    } catch (caught) {
      setError(toError(caught));
    }
  }, [launch.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function importFile(file) {
    setImporting(true);
    setError(null);
    try {
      const response = await api.importTeam(launch.id, file);
      setResult(response.data);
      // A resposta da importacao traz a equipe resumida; a lista completa
      // (CPF, funcao, datas) vem da rota da equipe.
      await load();
    } catch (caught) {
      setError(toError(caught));
    } finally {
      setImporting(false);
    }
  }

  async function resolve(worker, issue) {
    try {
      const response = await api.updateWorker(worker.id, {
        resolve_issues: [{ code: issue.code, field: issue.field }],
      });
      setWorkers((current) =>
        current.map((w) => (w.id === worker.id ? response.data : w)),
      );
    } catch (caught) {
      setError(toError(caught));
    }
  }

  const pending = (workers ?? []).filter(
    (worker) => open(worker.issues).length > 0,
  ).length;

  return (
    <section aria-labelledby="team-title" className="rpa-section">
      <h3 id="team-title" className="rpa-section__title">
        Equipe
      </h3>

      {canWrite && (
        <FileDrop
          label="Arraste o .xlsx ou .csv das respostas do formulario, ou clique para escolher"
          accept=".xlsx,.csv,text/csv"
          disabled={importing}
          onFile={importFile}
        />
      )}

      <ErrorAlert error={error} />
      {result && <ImportResult result={result} />}

      {workers === null ? (
        <p className="state">Carregando equipe...</p>
      ) : workers.length === 0 ? (
        <p className="state">
          Ninguem na equipe ainda: importe as respostas do formulario.
        </p>
      ) : (
        <>
          <p className="filter__count" aria-live="polite">
            {workers.length} {workers.length === 1 ? 'pessoa' : 'pessoas'},{' '}
            {pending} com pendencia
          </p>
          <ul className="list" aria-label="Equipe">
            {workers.map((worker) => {
              const issues = open(worker.issues);
              return (
                <li key={worker.id} className="list-item rpa-worker">
                  <div className="list-item__main">
                    <span className="list-item__title">
                      {worker.number}. {worker.name}
                    </span>
                    <div className="list-item__meta">
                      <span>CPF {formatCpf(worker.cpf)}</span>
                      <span>{worker.role || 'Sem funcao'}</span>
                      {worker.starts_on && (
                        <span>Inicio {formatDate(worker.starts_on)}</span>
                      )}
                      {worker.left_on && (
                        <span>Saida {formatDate(worker.left_on)}</span>
                      )}
                      <span
                        className={`badge badge--${issues.length ? 'needs_review' : 'done'}`}
                      >
                        {issues.length
                          ? `${issues.length} pendencia${issues.length > 1 ? 's' : ''}`
                          : 'Sem pendencia'}
                      </span>
                    </div>
                    {issues.length > 0 && (
                      <ul
                        className="rpa-issues"
                        aria-label={`Pendencias de ${worker.name}`}
                      >
                        {issues.map((issue) => (
                          <li key={`${issue.code}-${issue.field}`}>
                            <span>Pendencia: {issue.message}</span>
                            {canWrite && (
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                onClick={() => resolve(worker, issue)}
                              >
                                Dar por resolvida
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {editingId === worker.id && (
                      <WorkerEditor
                        worker={worker}
                        onCancel={() => setEditingId(null)}
                        onSaved={(saved) => {
                          setWorkers((current) =>
                            current.map((w) => (w.id === saved.id ? saved : w)),
                          );
                          setEditingId(null);
                        }}
                      />
                    )}
                  </div>
                  {canWrite && editingId !== worker.id && (
                    <div className="list-item__actions">
                      <button
                        type="button"
                        className="btn btn--sm"
                        aria-label={`Corrigir ${worker.name}`}
                        onClick={() => setEditingId(worker.id)}
                      >
                        Corrigir
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
