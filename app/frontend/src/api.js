// All URLs are relative. In production CloudFront routes /api/* to the Express server;
// in development the Vite dev server proxies /api to http://localhost:8080.

async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (res.status === 204) return null;

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return body;
}

export const api = {
  // The health endpoint answers 503 + JSON when the database is down; return the body either way.
  async health() {
    const res = await fetch('/api/health');
    return res.json();
  },
  listTasks: () => request('/tasks'),
  createTask: (title) => request('/tasks', { method: 'POST', body: JSON.stringify({ title }) }),
  updateTask: (id, changes) => request(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(changes) }),
  deleteTask: (id) => request(`/tasks/${id}`, { method: 'DELETE' }),
};
