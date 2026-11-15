import { Component, Suspense, useState } from 'react';
import { House } from 'lucide-react';
import PageHeader from './PageHeader';
import Widget from './Widget';

/**
 * O Inicio: um widget por modulo que a sessao alcanca, cada um com o resumo
 * do proprio modulo e o atalho para abri-lo. A casca nao sabe o que cada
 * widget mostra — so onde ele fica.
 *
 * Os resumos saem todos ao abrir, em paralelo, e os widgets aparecem
 * **juntos**, quando o ultimo chega. Cada um aparecendo na sua hora empurrava
 * para baixo os que ja estavam na tela: o card de Tarefas crescia de uma linha
 * para a lista inteira, e o "Abrir" de baixo fugia do clique (CLS 0,15 no
 * trace). O preco e esperar o resumo mais lento para mostrar os tres.
 */
export default function HomeView({ user, modules, onOpenModule }) {
  const firstName = String(user.name).trim().split(/\s+/)[0];
  // Uma busca por abertura do Inicio: a casca remonta esta view a cada visita,
  // entao voltar de um modulo traz o resumo do que acabou de mudar.
  const [summaries] = useState(
    () => new Map(modules.map((module) => [module.id, module.loadSummary()])),
  );

  const open = (module) => (params) => onOpenModule(module.id, params);

  return (
    <>
      <PageHeader
        icon={House}
        title="Inicio"
        description={`Ola, ${firstName}. O que esta em aberto em cada modulo.`}
      />

      {modules.length === 0 ? (
        <p className="state">
          Nenhum modulo liberado para o seu acesso. Fale com um administrador.
        </p>
      ) : (
        <Suspense
          fallback={
            <div className="widgets">
              {modules.map((module) => (
                <Widget key={module.id} module={module} onOpen={open(module)}>
                  <p className="widget__empty">Carregando...</p>
                </Widget>
              ))}
            </div>
          }
        >
          <div className="widgets">
            {modules.map((module) => (
              <WidgetBoundary
                key={module.id}
                module={module}
                onOpen={open(module)}
              >
                <module.HomeWidget
                  module={module}
                  onOpen={open(module)}
                  summaryPromise={summaries.get(module.id)}
                />
              </WidgetBoundary>
            ))}
          </div>
        </Suspense>
      )}
    </>
  );
}

/**
 * Prende no proprio card o resumo que falhou: os outros modulos seguem
 * mostrando o deles, e o "Abrir" continua ali.
 */
class WidgetBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <Widget module={this.props.module} onOpen={this.props.onOpen}>
          <p className="widget__empty">{this.state.error.message}</p>
        </Widget>
      );
    }

    return this.props.children;
  }
}
