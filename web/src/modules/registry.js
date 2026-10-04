import { lazy } from 'react';
import { ListTodo, ReceiptText } from 'lucide-react';
import TasksHomeWidget from './tasks/TasksHomeWidget';
import ExpensesHomeWidget from './expenses/ExpensesHomeWidget';

/**
 * Os modulos da casca, na ordem da barra lateral — a fonte unica de onde a
 * barra, o menu inferior e o Inicio tiram o que mostrar.
 *
 * Cada modulo diz o escopo que o torna util (`readScope`): quem nao o tem nao
 * ve o modulo, em vez de abrir uma tela que so responderia 403. O de escrita
 * vira o `canWrite` da view. A view carrega sob demanda — a Prestacao de
 * Contas, com revisao, imagem e upload, nao pesa na abertura de quem so usa
 * Tarefas —, e o widget do Inicio vem junto com a casca.
 *
 * Modulo novo: uma entrada aqui, a view e o widget. A casca nao muda.
 */
export const MODULES = [
  {
    id: 'tasks',
    name: 'Tarefas',
    description: 'O quadro de tarefas da equipe.',
    icon: ListTodo,
    readScope: 'tasks:read',
    writeScope: 'tasks:write',
    View: lazy(() => import('../components/TasksApp')),
    HomeWidget: TasksHomeWidget,
  },
  {
    id: 'expenses',
    name: 'Prestacao de Contas',
    description:
      'Relatorios de viagem, comprovantes e as entregas do procedimento.',
    icon: ReceiptText,
    readScope: 'reports:read',
    writeScope: 'reports:write',
    View: lazy(() => import('../components/ExpensesApp')),
    HomeWidget: ExpensesHomeWidget,
  },
];

/** Os modulos que a sessao alcanca, na ordem do registro. */
export function visibleModules(user) {
  return MODULES.filter((module) => user.scopes.includes(module.readScope));
}
