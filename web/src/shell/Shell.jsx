import { Suspense, useEffect, useRef, useState } from 'react';
import { visibleModules } from '../modules/registry';
import HomeView from './HomeView';
import MobileNav from './MobileNav';
import ModuleBoundary from './ModuleBoundary';
import PageHeader from './PageHeader';
import SettingsView from './SettingsView';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { readTheme, saveTheme } from './theme';
import useMediaQuery from './useMediaQuery';

/**
 * A casca da tela logada: navegacao, barra superior e a area onde abre o
 * Inicio, um modulo ou os Ajustes.
 *
 * Sem router, como antes (backlog Issue 19): o que esta aberto e estado
 * daqui. `visit` muda a cada clique num modulo e entra na `key` da view, entao
 * clicar no modulo aberto volta para o comeco dele — a lista, e nao o
 * detalhe em que se estava.
 */
export default function Shell({ user, onLogout }) {
  const modules = visibleModules(user);
  const [view, setView] = useState({ kind: 'home' });
  const [theme, setTheme] = useState(readTheme);
  const narrow = useMediaQuery('(max-width: 767px)');
  const contentRef = useRef(null);
  const visits = useRef(0);

  const module =
    view.kind === 'module'
      ? modules.find((item) => item.id === view.moduleId)
      : null;
  const title =
    view.kind === 'settings' ? 'Ajustes' : (module?.name ?? 'Inicio');

  // A aba do navegador diz onde se esta; ao sair, volta o titulo do login.
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} — tasktab`;
    return () => {
      document.title = previous;
    };
  }, [title]);

  // Cada destino comeca do topo: sem isto, quem saia do fim de um relatorio
  // longo para outro modulo caia no meio da pagina nova.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  // O "Abrir" de um widget some com o Inicio, e o foco cairia no <body>:
  // quem navega pelo teclado recomecaria do topo da pagina. Quando o foco se
  // perde assim, ele vai para o titulo da pagina nova. Quem clicou na
  // navegacao continua nela.
  useEffect(() => {
    if (!document.activeElement || document.activeElement === document.body) {
      contentRef.current?.querySelector('h2')?.focus();
    }
  }, [view]);

  function navigate(next) {
    visits.current += 1;
    setView({ ...next, visit: visits.current });
  }

  function openModule(moduleId, params) {
    navigate({ kind: 'module', moduleId, params });
  }

  function changeTheme(next) {
    saveTheme(next);
    setTheme(next);
  }

  return (
    <div className={narrow ? 'shell shell--narrow' : 'shell'}>
      {!narrow && (
        <Sidebar
          user={user}
          modules={modules}
          view={view}
          onNavigate={navigate}
          onLogout={onLogout}
        />
      )}

      <div className="shell__main">
        <TopBar
          title={title}
          narrow={narrow}
          theme={theme}
          onThemeChange={changeTheme}
          onLogout={onLogout}
        />

        <main className="shell__content" ref={contentRef}>
          {view.kind === 'home' && (
            <HomeView user={user} modules={modules} onOpenModule={openModule} />
          )}

          {view.kind === 'settings' && (
            <SettingsView
              user={user}
              theme={theme}
              onThemeChange={changeTheme}
            />
          )}

          {module && (
            <div key={view.visit}>
              <PageHeader
                icon={module.icon}
                title={module.name}
                description={module.description}
              />
              <ModuleBoundary name={module.name}>
                <Suspense
                  fallback={
                    <p className="state">Carregando {module.name}...</p>
                  }
                >
                  <module.View
                    canWrite={user.scopes.includes(module.writeScope)}
                    {...view.params}
                  />
                </Suspense>
              </ModuleBoundary>
            </div>
          )}
        </main>
      </div>

      {narrow && (
        <MobileNav modules={modules} view={view} onNavigate={navigate} />
      )}
    </div>
  );
}
