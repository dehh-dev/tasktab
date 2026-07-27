import { statusLabel, formatDate } from '../constants';

function TaskItem({ task, onEdit, onDelete, busy }) {
  const dueDate = formatDate(task.due_date);

  return (
    <li className="task">
      <div className="task__main">
        <div className="task__title">{task.title}</div>
        {task.description && (
          <p className="task__description">{task.description}</p>
        )}
        <div className="task__meta">
          <span className={`badge badge--${task.status}`}>
            {statusLabel(task.status)}
          </span>
          <span>#{task.id}</span>
          {dueDate && <span>Prazo: {dueDate}</span>}
        </div>
      </div>

      <div className="task__actions">
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => onEdit(task)}
          disabled={busy}
        >
          Editar
        </button>
        <button
          type="button"
          className="btn btn--sm btn--danger"
          onClick={() => onDelete(task)}
          disabled={busy}
        >
          Deletar
        </button>
      </div>
    </li>
  );
}

export default function TaskList({ tasks, onEdit, onDelete, busy }) {
  if (tasks.length === 0) {
    return <p className="state">Nenhuma tarefa encontrada para este filtro.</p>;
  }

  return (
    <ul className="list">
      {tasks.map((task) => (
        <TaskItem
          key={task.id}
          task={task}
          onEdit={onEdit}
          onDelete={onDelete}
          busy={busy}
        />
      ))}
    </ul>
  );
}
