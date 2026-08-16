import { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import { ApiError } from '../api';
import StatusFilter from './StatusFilter';
import TaskForm from './TaskForm';
import TaskList from './TaskList';
import ConfirmDialog from './ConfirmDialog';

/**
 * Conteudo da aba "Tarefas". Extraido do antigo App.jsx sem mudar
 * comportamento nenhum, para a troca de abas (Issue 19) nao exigir tocar em
 * nada aqui — as specs de e2e/tasks.spec.js e companhia continuam valendo
 * como estavam.
 */
export default function TasksApp() {
  const [tasks, setTasks] = useState([]);
  const [total, setTotal] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // null = formulario fechado | 'new' = criacao | objeto = edicao
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.listTasks({ status: statusFilter });
      setTasks(response.data);
      setTotal(response.meta.total);
      setError(null);
    } catch (caught) {
      setError({ message: caught.message, action: caught.action });
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setFieldErrors({});
    setEditing('new');
  }

  function openEdit(task) {
    setFieldErrors({});
    setEditing(task);
  }

  function closeForm() {
    setEditing(null);
    setFieldErrors({});
  }

  async function handleSubmit(values) {
    setSubmitting(true);
    setFieldErrors({});

    try {
      if (editing === 'new') {
        await api.createTask(values);
      } else {
        await api.updateTask(editing.id, values);
      }
      closeForm();
      await load();
    } catch (caught) {
      // 422 traz erros por campo; o formulario os exibe no campo certo e
      // preserva o que o usuario digitou.
      const byField = caught instanceof ApiError ? caught.fieldErrors() : {};

      if (Object.keys(byField).length > 0) {
        setFieldErrors(byField);
      } else {
        setError({ message: caught.message, action: caught.action });
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.deleteTask(pendingDelete.id);
      setPendingDelete(null);

      // Se a tarefa aberta no formulario foi a deletada, fecha o formulario.
      if (editing !== 'new' && editing?.id === pendingDelete.id) {
        closeForm();
      }
      await load();
    } catch (caught) {
      setError({ message: caught.message, action: caught.action });
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      {error && (
        <div className="alert" role="alert">
          <div className="alert__title">{error.message}</div>
          {error.action && <div>{error.action}</div>}
        </div>
      )}

      <div className="toolbar">
        <StatusFilter
          value={statusFilter}
          onChange={setStatusFilter}
          total={total}
        />
        <button
          type="button"
          className="btn btn--primary"
          onClick={openCreate}
          disabled={editing === 'new'}
        >
          Nova tarefa
        </button>
      </div>

      {editing && (
        <TaskForm
          key={editing === 'new' ? 'new' : editing.id}
          task={editing === 'new' ? null : editing}
          onSubmit={handleSubmit}
          onCancel={closeForm}
          submitting={submitting}
          serverErrors={fieldErrors}
        />
      )}

      {loading ? (
        <p className="state">Carregando tarefas...</p>
      ) : (
        <TaskList
          tasks={tasks}
          onEdit={openEdit}
          onDelete={setPendingDelete}
          busy={deleting}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Deletar tarefa?"
          target={pendingDelete.title}
          confirmLabel="Deletar"
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
          busy={deleting}
        />
      )}
    </>
  );
}
