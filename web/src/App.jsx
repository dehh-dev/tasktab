import { useState } from 'react';
import TabNav from './components/TabNav';
import TasksApp from './components/TasksApp';
import ExpensesApp from './components/ExpensesApp';

const TABS = [
  { value: 'tasks', label: 'Tarefas' },
  { value: 'expenses', label: 'Prestacao de Contas' },
];

export default function App() {
  const [tab, setTab] = useState('tasks');

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">tasktab</h1>
        <p className="app__subtitle">Tarefas e prestacao de contas</p>
      </header>

      <TabNav tabs={TABS} active={tab} onChange={setTab} />

      {
        // Desmontado, nao so escondido: os dois dominios usam listas com o
        // mesmo tipo de marcacao, e manter os dois no DOM ao mesmo tempo (so
        // com `hidden`) deixava locators estruturais de um teste contarem
        // elementos que vazaram do outro dominio. Aconteceu de verdade.
      }
      {tab === 'tasks' && (
        <div id="panel-tasks" role="tabpanel" aria-labelledby="tab-tasks">
          <TasksApp />
        </div>
      )}

      {tab === 'expenses' && (
        <div id="panel-expenses" role="tabpanel" aria-labelledby="tab-expenses">
          <ExpensesApp />
        </div>
      )}
    </div>
  );
}
