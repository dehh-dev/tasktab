import { useCallback, useEffect, useState } from 'react';
import * as api from './api';
import LoginScreen from './components/LoginScreen';
import Shell from './shell/Shell';

export default function App() {
  // undefined = ainda perguntando ao servidor | null = sem sessao | objeto = logado
  const [user, setUser] = useState(undefined);
  // Por que a pessoa voltou ao login, quando nao foi ela quem saiu.
  const [notice, setNotice] = useState(null);

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
    setUser(authenticated);
  }

  async function handleLogout() {
    await api.logout().catch(() => {});
    setUser(null);
  }

  if (user === undefined) {
    return <p className="state state--boot">Carregando...</p>;
  }

  if (user === null) {
    return (
      <LoginScreen onAuthenticated={handleAuthenticated} notice={notice} />
    );
  }

  // A casca desmonta por inteiro no logout: quem entrar depois comeca do
  // Inicio, sem o modulo ou o formulario que a sessao anterior deixou aberto.
  return <Shell user={user} onLogout={handleLogout} />;
}
