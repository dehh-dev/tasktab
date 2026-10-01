import { useCallback, useEffect, useState } from 'react';
import * as api from './api';
import TabNav from './components/TabNav';
import TasksApp from './components/TasksApp';
import ExpensesApp from './components/ExpensesApp';
import LoginScreen from './components/LoginScreen';
import ChangePassword from './components/ChangePassword';

const ROLE_LABELS = {
  admin: 'Administrador',
  user: 'Usuario',
  auditor: 'Auditor',
};

// Cada aba declara o escopo que a torna util. Quem nao o tem nao a ve: um
// auditor sem `tasks:read` nao ganha uma aba que so responderia 403.
const TABS = [
  { value: 'tasks', label: 'Tarefas', scope: 'tasks:read' },
  { value: 'expenses', label: 'Prestacao de Contas', scope: 'reports:read' },
];

export default function App() {
  // undefined = ainda perguntando ao servidor | null = sem sessao | objeto = logado
  const [user, setUser] = useState(undefined);
  // Por que a pessoa voltou ao login, quando nao foi ela quem saiu.
  const [notice, setNotice] = useState(null);
  const [tab, setTab] = useState('tasks');
  const [changingPassword, setChangingPassword] = useState(false);
  // Confirmacao da troca de senha, mostrada no lugar do formulario.
  const [passwordNotice, setPasswordNotice] = useState(null);

  const loadSession = useCallback(async () => {
    try {
      const response = await api.getMe();
      setUser(response.data);
    } catch {
      // Qualquer falha aqui — 401, servidor fora do ar — leva a tela de login,
      // que e onde a pessoa tem algo a fazer.
      setUser(null);
    }
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // So escuta enquanto ha alguem logado: uma resposta atrasada de uma tela que
  // ja fechou nao pode enfeitar o login de quem saiu por vontade propria com
  // um aviso de sessao perdida.
  useEffect(() => {
    if (!user) {
      return undefined;
    }

    return api.onSessionLost((error) => {
      setNotice({ message: error.message, action: error.action });
      setUser(null);
    });
  }, [user]);

  function handleAuthenticated(authenticated) {
    setNotice(null);
    setChangingPassword(false);
    setPasswordNotice(null);
    setUser(authenticated);
  }

  function handlePasswordDone(message) {
    setChangingPassword(false);
    setPasswordNotice(message);
  }

  async function handleLogout() {
    await api.logout().catch(() => {});
    setUser(null);
  }

  if (user === undefined) {
    return <p className="state">Carregando...</p>;
  }

  if (user === null) {
    return (
      <LoginScreen onAuthenticated={handleAuthenticated} notice={notice} />
    );
  }

  const tabs = TABS.filter((item) => user.scopes.includes(item.scope));
  const active = tabs.some((item) => item.value === tab) ? tab : tabs[0]?.value;

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1 className="app__title">tasktab</h1>
          <p className="app__subtitle">Tarefas e prestacao de contas</p>
        </div>

        <div className="app__session">
          <span className="app__user">
            {user.name}
            <span className="app__role">{ROLE_LABELS[user.role]}</span>
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setPasswordNotice(null);
              setChangingPassword(true);
            }}
            disabled={changingPassword}
          >
            Alterar senha
          </button>
          <button type="button" className="btn" onClick={handleLogout}>
            Sair
          </button>
        </div>
      </header>

      {changingPassword && (
        <ChangePassword userId={user.id} onDone={handlePasswordDone} />
      )}

      {passwordNotice && (
        <p className="state" role="status">
          {passwordNotice}
        </p>
      )}

      <TabNav tabs={tabs} active={active} onChange={setTab} />

      {
        // Desmontado, nao so escondido: os dois dominios usam listas com o
        // mesmo tipo de marcacao, e manter os dois no DOM ao mesmo tempo (so
        // com `hidden`) deixava locators estruturais de um teste contarem
        // elementos que vazaram do outro dominio. Aconteceu de verdade.
      }
      {active === 'tasks' && (
        <div id="panel-tasks" role="tabpanel" aria-labelledby="tab-tasks">
          <TasksApp canWrite={user.scopes.includes('tasks:write')} />
        </div>
      )}

      {active === 'expenses' && (
        <div id="panel-expenses" role="tabpanel" aria-labelledby="tab-expenses">
          <ExpensesApp canWrite={user.scopes.includes('reports:write')} />
        </div>
      )}
    </div>
  );
}
