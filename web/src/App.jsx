import { useCallback, useEffect, useState } from 'react';
import * as api from './api';
import { ApiError } from './api';
import StatusFilter from './components/StatusFilter';
import TaskForm from './components/TaskForm';
import TaskList from './components/TaskList';
import ConfirmDialog from './components/ConfirmDialog';

export default function App() {
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
      setError(caught.message);
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
        setError(caught.message);
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
      setError(caught.message);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">tasktab</h1>
        <p className="app__subtitle">Gerenciador de Tarefas</p>
      </header>

      {error && (
        <div className="alert" role="alert">
          <div className="alert__title">Algo deu errado</div>
          <div>{error}</div>
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
    </div>
  );
}
