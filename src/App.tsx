import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Task = {
  id: string;
  title: string;
  done: boolean;
  created_at: number;
};

type Filter = "all" | "active" | "done";

function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<Task[]>("list_tasks")
      .then(setTasks)
      .catch((e) => setError(String(e)));
  }, []);

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    try {
      const task = await invoke<Task>("add_task", { title });
      setTasks((prev) => [...prev, task]);
      setDraft("");
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  async function toggle(id: string) {
    try {
      await invoke("toggle_task", { id });
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
      );
    } catch (err) {
      setError(String(err));
    }
  }

  async function remove(id: string) {
    try {
      await invoke("delete_task", { id });
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(String(err));
    }
  }

  const visible = tasks.filter((t) => {
    if (filter === "active") return !t.done;
    if (filter === "done") return t.done;
    return true;
  });
  const remaining = tasks.filter((t) => !t.done).length;

  return (
    <main className="container">
      <header className="hero">
        <h1>Pansutong</h1>
        <p className="subtitle">Tasks that follow you between desktop and phone.</p>
      </header>

      <form className="composer" onSubmit={addTask}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          placeholder="What needs doing?"
          aria-label="New task"
        />
        <button type="submit">Add</button>
      </form>

      {error && <p className="error">{error}</p>}

      <div className="toolbar">
        <span>{remaining} left</span>
        <div className="filters">
          {(["all", "active", "done"] as Filter[]).map((f) => (
            <button
              key={f}
              className={filter === f ? "chip chip--active" : "chip"}
              onClick={() => setFilter(f)}
              type="button"
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <ul className="tasks">
        {visible.length === 0 && (
          <li className="empty">Nothing here yet.</li>
        )}
        {visible.map((t) => (
          <li key={t.id} className={t.done ? "task task--done" : "task"}>
            <label>
              <input
                type="checkbox"
                checked={t.done}
                onChange={() => toggle(t.id)}
              />
              <span className="title">{t.title}</span>
            </label>
            <button
              className="delete"
              onClick={() => remove(t.id)}
              aria-label={`Delete ${t.title}`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}

export default App;
