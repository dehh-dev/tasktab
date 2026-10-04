import { House } from 'lucide-react';
import PageHeader from './PageHeader';

/**
 * O Inicio: um widget por modulo que a sessao alcanca, cada um com o resumo
 * do proprio modulo e o atalho para abri-lo. A casca nao sabe o que cada
 * widget mostra — so onde ele fica.
 */
export default function HomeView({ user, modules, onOpenModule }) {
  const firstName = String(user.name).trim().split(/\s+/)[0];

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
        <div className="widgets">
          {modules.map((module) => (
            <module.HomeWidget
              key={module.id}
              module={module}
              onOpen={(params) => onOpenModule(module.id, params)}
            />
          ))}
        </div>
      )}
    </>
  );
}
