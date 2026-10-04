import { useState } from 'react';
import { KeyRound, Settings } from 'lucide-react';
import ChangePassword from '../components/ChangePassword';
import PageHeader from './PageHeader';
import { ROLE_LABELS } from './session';
import { THEMES } from './theme';

/**
 * Ajustes: a aparencia, que fica neste navegador, e a conta, que e do
 * servidor. A troca de senha mora aqui desde que o cabecalho virou barra
 * lateral.
 */
export default function SettingsView({ user, theme, onThemeChange }) {
  const [changingPassword, setChangingPassword] = useState(false);
  // A confirmacao da troca fica no lugar do formulario.
  const [passwordNotice, setPasswordNotice] = useState(null);

  return (
    <>
      <PageHeader
        icon={Settings}
        title="Ajustes"
        description="Aparencia desta tela e os dados da sua conta."
      />

      <div className="settings">
        <section className="card" aria-labelledby="ajustes-aparencia">
          <h3 className="card__title" id="ajustes-aparencia">
            Aparencia
          </h3>
          <fieldset className="choice">
            <legend className="field__label">Tema</legend>
            <div className="segmented">
              {THEMES.map((option) => {
                const Icon = option.icon;
                return (
                  <label key={option.value} className="segmented__option">
                    <input
                      type="radio"
                      className="sr-only"
                      name="tema"
                      value={option.value}
                      checked={theme === option.value}
                      onChange={() => onThemeChange(option.value)}
                    />
                    <Icon size={16} aria-hidden="true" />
                    {option.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <p className="field__hint">
            Sistema acompanha o claro ou escuro do aparelho. A escolha fica
            neste navegador.
          </p>
        </section>

        <section className="card" aria-labelledby="ajustes-conta">
          <h3 className="card__title" id="ajustes-conta">
            Conta
          </h3>
          <dl className="details">
            <div>
              <dt>Nome</dt>
              <dd>{user.name}</dd>
            </div>
            <div>
              <dt>E-mail</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>Papel</dt>
              <dd>{ROLE_LABELS[user.role]}</dd>
            </div>
          </dl>

          {changingPassword ? (
            <ChangePassword
              userId={user.id}
              onDone={(message) => {
                setChangingPassword(false);
                setPasswordNotice(message);
              }}
            />
          ) : (
            <div className="card__actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setPasswordNotice(null);
                  setChangingPassword(true);
                }}
              >
                <KeyRound size={16} aria-hidden="true" />
                Alterar senha
              </button>
            </div>
          )}

          {passwordNotice && (
            <p className="state" role="status">
              {passwordNotice}
            </p>
          )}
        </section>
      </div>
    </>
  );
}
