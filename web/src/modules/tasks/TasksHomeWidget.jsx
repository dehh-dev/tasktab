import { use } from 'react';
import * as api from '../../api';
import { formatDate, statusLabel } from '../../constants';
import Widget, { WidgetStat } from '../../shell/Widget';

const SHOWN = 5;
const SOON_DAYS = 7;

const pad = (value) => String(value).padStart(2, '0');

/** Hoje no relogio de quem usa, como YYYY-MM-DD. */
function today() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function addDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

/**
 * O resumo das tarefas no Inicio: quantas ha em cada status e as abertas que
 * vencem nos proximos 7 dias ou ja venceram, a que vence primeiro no topo
 * (issue 74). Os totais vem do `meta.total` de cada lista filtrada — contar no
 * cliente so veria a primeira pagina. A API ja ordena pelo prazo: as 5
 * primeiras de cada status aberto contem as 5 mais urgentes de todas, sem
 * endpoint novo.
 */
export async function loadTasksSummary() {
  const [doing, todo, waiting, done] = await Promise.all([
    api.listTasks({ status: 'in_progress', limit: SHOWN }),
    api.listTasks({ status: 'pending', limit: SHOWN }),
    api.listTasks({ status: 'waiting', limit: SHOWN }),
    api.listTasks({ status: 'done', limit: 1 }),
  ]);

  const now = today();
  const limit = addDays(now, SOON_DAYS);
  const due = [...doing.data, ...todo.data, ...waiting.data]
    .filter((task) => task.due_date && task.due_date <= limit)
    .sort((a, b) =>
      a.due_date === b.due_date ? 0 : a.due_date < b.due_date ? -1 : 1,
    )
    .slice(0, SHOWN);

  return {
    doing: doing.meta.total,
    todo: todo.meta.total,
    waiting: waiting.meta.total,
    done: done.meta.total,
    today: now,
    due,
  };
}

/** Tarefas no Inicio. O resumo chega pronto do `HomeView`. */
export default function TasksHomeWidget({ module, onOpen, summaryPromise }) {
  const summary = use(summaryPromise);

  return (
    <Widget module={module} onOpen={onOpen}>
      <dl className="widget__stats">
        <WidgetStat label="Pendentes" value={summary.todo} />
        <WidgetStat label="Em andamento" value={summary.doing} />
        <WidgetStat label="Aguardando" value={summary.waiting} />
        <WidgetStat label="Concluidas" value={summary.done} />
      </dl>

      {summary.due.length === 0 ? (
        <p className="widget__empty">
          Nenhuma tarefa aberta vence nos proximos 7 dias.
        </p>
      ) : (
        <ul className="widget__list" aria-label="Prazo nos proximos 7 dias">
          {summary.due.map((task) => (
            <li key={task.id} className="widget__item">
              <span className="widget__item-title">{task.title}</span>
              <span className="widget__item-meta">
                <span className={`badge badge--${task.status}`}>
                  {statusLabel(task.status)}
                </span>
                <span>
                  {task.due_date < summary.today
                    ? `Vencida em ${formatDate(task.due_date)}`
                    : `Prazo ${formatDate(task.due_date)}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}
