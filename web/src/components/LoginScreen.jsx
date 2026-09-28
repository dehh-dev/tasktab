import { useState } from 'react';
import * as api from '../api';

/**
 * Porta de entrada. Nao ha tela de cadastro: criar pessoa exige `users:write`
 * na API, e o primeiro usuario sai pela linha de comando
 * (`npm run users:create`). Numa ferramenta que guarda cupom fiscal com CNPJ
 * de terceiros, um "criar conta" aberto seria uma porta para qualquer um.
 */
export default function LoginScreen({ onAuthenticated }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await api.login(email, password);
      onAuthenticated(response.data);
    } catch (caught) {
      setError({ message: caught.message, action: caught.action });
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login">
      <form className="login__form form" onSubmit={handleSubmit}>
        <h2 className="login__title">Entrar no tasktab</h2>

        {error && (
          <div className="alert" role="alert">
            <div className="alert__title">{error.message}</div>
            {error.action && <div>{error.action}</div>}
          </div>
        )}

        <div className="field">
          <label className="field__label" htmlFor="login-email">
            E-mail
          </label>
          <input
            id="login-email"
            className="field__input"
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="login-password">
            Senha
          </label>
          <input
            id="login-password"
            className="field__input"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <div className="form__actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={submitting}
          >
            {submitting ? 'Entrando...' : 'Entrar'}
          </button>
        </div>
      </form>
    </div>
  );
}
