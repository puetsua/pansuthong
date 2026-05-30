import { FormEvent, useState } from "react";
import { api, Tag } from "../../lib/tauri";
import { ColorPicker } from "../../components/ColorPicker";

type Props = { tags: Tag[] };

export function TagManager({ tags }: Props) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#10b981");
  const [error, setError] = useState<string | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.addTag(name.trim().toLowerCase(), color);
      setName("");
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  };

  const remove = async (t: Tag) => {
    if (!window.confirm(`Delete tag #${t.name}? It will be removed from all tasks.`)) return;
    try { await api.deleteTag(t.id); }
    catch (err) { setError(String(err)); }
  };

  return (
    <section className="settings-section">
      <h2>Tags</h2>
      <form className="settings-row" onSubmit={add}>
        <ColorPicker value={color} onChange={setColor} />
        <input
          value={name}
          onChange={e => setName(e.currentTarget.value)}
          placeholder="new-tag-name"
          aria-label="New tag name"
        />
        <button type="submit" disabled={!name.trim()}>Add tag</button>
      </form>
      {error && <p className="composer-error">{error}</p>}
      <ul className="settings-list">
        {tags.length === 0 && <li className="settings-empty">No tags yet.</li>}
        {tags.map(t => (
          <li key={t.id}>
            <span className="color-dot" style={{ background: t.color }} />
            <span className="settings-name">#{t.name}</span>
            <button className="link-button danger" onClick={() => remove(t)}>delete</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
