import { FormEvent, useState } from "react";
import { api } from "../lib/tauri";

type Props = { scheduledDate?: string };

export function Composer({ scheduledDate }: Props) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    try {
      await api.addTask({ title: t, scheduled_date: scheduledDate });
      setTitle("");
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <form className="composer" onSubmit={submit}>
      <input
        value={title}
        onChange={e => setTitle(e.currentTarget.value)}
        placeholder="What needs doing?"
        aria-label="New task"
      />
      <button type="submit">Add</button>
      {error && <p className="composer-error">{error}</p>}
    </form>
  );
}
