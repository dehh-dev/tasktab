import { useState } from 'react';
import * as api from '../api';
import { ApiError } from '../api';

/**
 * Troca da propria senha.
 *
 * Nao depende de administrador: a API deixa qualquer pessoa alterar o proprio
 * cadastro, e ate aqui isso so era possivel por `curl`. A senha atual e
 * exigida pelo servidor, e as outras sessoes da pessoa caem depois da troca —
 * a mensagem de sucesso diz isso, porque e o que alguem que desconfia de um
 * vazamento precisa saber.
 */
export default function ChangePassword({ userId, onDone }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setFieldErrors({});
    setError(null);

    try {
      await api.changeOwnPassword(userId, current, next);
      onDone('Senha alterada. As outras sessoes abertas foram encerradas.');
    } catch (caught) {
      const byField = caught instanceof ApiError ? caught.fieldErrors() : {};

      if (Object.keys(byField).length > 0) {
        setFieldErrors(byField);
      } else {
        setError({ message: caught.message, action: caught.action });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <h3 className="form__title">Alterar senha</h3>

      {error && (
        <div className="alert" role="alert">
          <div className="alert__title">{error.message}</div>
          {error.action && <div>{error.action}</div>}
        </div>
      )}

      <div className="form__grid">
        <div className="field">
          <label className="field__label" htmlFor="password-current">
            Senha atual
          </label>
          <input
            id="password-current"
            className="field__input"
            type="password"
            autoComplete="current-password"
            value={current}
            aria-invalid={Boolean(fieldErrors.current_password)}
            onChange={(event) => setCurrent(event.target.value)}
          />
          {fieldErrors.current_password && (
            <span className="field__error" role="alert">
              {fieldErrors.current_password}
            </span>
          )}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="password-new">
            Nova senha
          </label>
          <input
            id="password-new"
            className="field__input"
            type="password"
            autoComplete="new-password"
            value={next}
            aria-invalid={Boolean(fieldErrors.password)}
            onChange={(event) => setNext(event.target.value)}
          />
          {fieldErrors.password && (
            <span className="field__error" role="alert">
              {fieldErrors.password}
            </span>
          )}
        </div>
      </div>

      <div className="form__actions">
        <button type="button" className="btn" onClick={() => onDone(null)}>
          Cancelar
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={submitting}
        >
          {submitting ? 'Salvando...' : 'Alterar senha'}
        </button>
      </div>
    </form>
  );
}
