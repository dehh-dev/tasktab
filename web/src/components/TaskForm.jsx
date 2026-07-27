import { useState } from 'react';
import { STATUSES } from '../constants';

const TITLE_MAX_LENGTH = 255;

const EMPTY = { title: '', description: '', status: 'pending', due_date: '' };

/**
 * Formulario unico para criacao e edicao. O App monta com key distinta por
 * tarefa, entao o estado inicial nao precisa ser ressincronizado por efeito.
 */
export default function TaskForm({
  task,
  onSubmit,
  onCancel,
  submitting,
  serverErrors = {},
}) {
  const isEditing = Boolean(task);

  const [values, setValues] = useState(() =>
    task
      ? {
          title: task.title,
          description: task.description ?? '',
          status: task.status,
          due_date: task.due_date ?? '',
        }
      : EMPTY,
  );
  const [localErrors, setLocalErrors] = useState({});

  const errors = { ...serverErrors, ...localErrors };

  function setField(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
    setLocalErrors((current) => {
      if (!current[field]) {
        return current;
      }
      const { [field]: _removed, ...rest } = current;
      return rest;
    });
  }

  function validate() {
    const found = {};
    const title = values.title.trim();

    if (!title) {
      found.title = 'title e obrigatorio';
    } else if (title.length > TITLE_MAX_LENGTH) {
      found.title = `title deve ter no maximo ${TITLE_MAX_LENGTH} caracteres`;
    }

    setLocalErrors(found);
    return Object.keys(found).length === 0;
  }

  function handleSubmit(event) {
    event.preventDefault();

    if (!validate()) {
      return;
    }

    // Opcionais vazios viram null: e assim que a API distingue "limpar campo"
    // de "nao mexer no campo".
    onSubmit({
      title: values.title.trim(),
      description: values.description.trim() || null,
      status: values.status,
      due_date: values.due_date || null,
    });
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <h2 className="form__title">
        {isEditing ? `Editando tarefa #${task.id}` : 'Nova tarefa'}
      </h2>

      <div className="form__grid">
        <div className="field field--full">
          <label className="field__label" htmlFor="title">
            Titulo
            <span className="field__required" aria-hidden="true">
              *
            </span>
          </label>
          <input
            id="title"
            className="field__input"
            type="text"
            value={values.title}
            maxLength={TITLE_MAX_LENGTH}
            required
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? 'title-error' : 'title-hint'}
            onChange={(event) => setField('title', event.target.value)}
          />
          {errors.title ? (
            <span className="field__error" id="title-error" role="alert">
              {errors.title}
            </span>
          ) : (
            <span className="field__hint" id="title-hint">
              {values.title.trim().length}/{TITLE_MAX_LENGTH} caracteres
            </span>
          )}
        </div>

        <div className="field field--full">
          <label className="field__label" htmlFor="description">
            Descricao
          </label>
          <textarea
            id="description"
            className="field__input"
            value={values.description}
            aria-invalid={Boolean(errors.description)}
            onChange={(event) => setField('description', event.target.value)}
          />
          {errors.description && (
            <span className="field__error" role="alert">
              {errors.description}
            </span>
          )}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="status">
            Status
          </label>
          <select
            id="status"
            className="field__input"
            value={values.status}
            onChange={(event) => setField('status', event.target.value)}
          >
            {STATUSES.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
          {errors.status && (
            <span className="field__error" role="alert">
              {errors.status}
            </span>
          )}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="due_date">
            Prazo
          </label>
          <input
            id="due_date"
            className="field__input"
            type="date"
            value={values.due_date}
            aria-invalid={Boolean(errors.due_date)}
            onChange={(event) => setField('due_date', event.target.value)}
          />
          {errors.due_date ? (
            <span className="field__error" role="alert">
              {errors.due_date}
            </span>
          ) : (
            <span className="field__hint">Opcional</span>
          )}
        </div>
      </div>

      <div className="form__actions">
        <button
          type="button"
          className="btn"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancelar
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={submitting}
        >
          {submitting
            ? 'Salvando...'
            : isEditing
              ? 'Salvar alteracoes'
              : 'Criar tarefa'}
        </button>
      </div>
    </form>
  );
}
