import { useEffect, useState } from 'react';
import * as api from '../../api';
import { formatDate, statusLabel } from '../../constants';
import Widget, { WidgetStat } from '../../shell/Widget';

const SHOWN = 5;

/**
 * Tarefas no Inicio: quantas ha em cada status e as que estao em aberto,
 * primeiro as em andamento. Os totais vem do `meta.total` de cada lista
 * filtrada — contar no cliente so veria a primeira pagina.
 */
export default function TasksHomeWidget({ module, onOpen }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let current = true;

    Promise.all([
      api.listTasks({ status: 'in_progress', limit: SHOWN }),
      api.listTasks({ status: 'pending', limit: SHOWN }),
      api.listTasks({ status: 'done', limit: 1 }),
    ])
      .then(([doing, todo, done]) => {
        if (current) {
          setSummary({
            doing: doing.meta.total,
            todo: todo.meta.total,
            done: done.meta.total,
            open: [...doing.data, ...todo.data].slice(0, SHOWN),
          });
        }
      })
      .catch((caught) => {
        if (current) {
          setError(caught.message);
        }
      });

    // A resposta de quem ja saiu do Inicio nao escreve num widget desmontado.
    return () => {
      current = false;
    };
  }, []);

  return (
    <Widget module={module} onOpen={onOpen}>
      {error && <p className="widget__empty">{error}</p>}
      {!error && !summary && <p className="widget__empty">Carregando...</p>}
      {summary && (
        <>
          <dl className="widget__stats">
            <WidgetStat label="Pendentes" value={summary.todo} />
            <WidgetStat label="Em andamento" value={summary.doing} />
            <WidgetStat label="Concluidas" value={summary.done} />
          </dl>

          {summary.open.length === 0 ? (
            <p className="widget__empty">Nenhuma tarefa em aberto.</p>
          ) : (
            <ul className="widget__list" aria-label="Tarefas em aberto">
              {summary.open.map((task) => (
                <li key={task.id} className="widget__item">
                  <span className="widget__item-title">{task.title}</span>
                  <span className="widget__item-meta">
                    <span className={`badge badge--${task.status}`}>
                      {statusLabel(task.status)}
                    </span>
                    {task.due_date && (
                      <span>Prazo {formatDate(task.due_date)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Widget>
  );
}
