import { useEffect, useState } from 'react';
import { api } from './api.js';

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState('');
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([api.listTasks(), api.health()]).then(([tasksResult, healthResult]) => {
      if (cancelled) return;
      if (tasksResult.status === 'fulfilled') setTasks(tasksResult.value);
      else setError(tasksResult.reason.message);
      setHealth(healthResult.status === 'fulfilled' ? healthResult.value : { status: 'unreachable' });
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAdd(event) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const task = await api.createTask(trimmed);
      setTasks((current) => [task, ...current]);
      setTitle('');
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(task) {
    try {
      const updated = await api.updateTask(task.id, { completed: !task.completed });
      setTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    try {
      await api.deleteTask(id);
      setTasks((current) => current.filter((t) => t.id !== id));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  const remaining = tasks.filter((t) => !t.completed).length;

  return (
    <main className="container">
      <header className="header">
        <h1>MERN on AWS</h1>
        <p className="subtitle">React on S3 + CloudFront · Express on EC2 (Docker) · MongoDB</p>
        <StatusBadge health={health} />
      </header>

      <form className="add-form" onSubmit={handleAdd}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs to be done?"
          maxLength={200}
          aria-label="New task"
        />
        <button type="submit" disabled={saving || !title.trim()}>
          {saving ? 'Adding…' : 'Add'}
        </button>
      </form>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="muted">No tasks yet. Add your first one above.</p>
      ) : (
        <ul className="task-list">
          {tasks.map((task) => (
            <li key={task.id} className={task.completed ? 'task done' : 'task'}>
              <label>
                <input type="checkbox" checked={task.completed} onChange={() => handleToggle(task)} />
                <span>{task.title}</span>
              </label>
              <button className="delete" onClick={() => handleDelete(task.id)} aria-label={`Delete ${task.title}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {tasks.length > 0 && (
        <footer className="footer">
          {remaining} of {tasks.length} remaining
        </footer>
      )}
    </main>
  );
}

function StatusBadge({ health }) {
  if (!health) return <span className="badge">Checking API…</span>;
  const healthy = health.status === 'ok';
  return (
    <span className={`badge ${healthy ? 'ok' : 'bad'}`}>
      API {healthy ? 'healthy' : health.status}
      {health.database && ` · DB ${health.database}`}
      {health.version && ` · ${health.version}`}
    </span>
  );
}
