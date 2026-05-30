import { FormEvent, KeyboardEvent, useState } from "react";
import { api, Tag } from "../../lib/tauri";
import { ColorPicker } from "../../components/ColorPicker";

type Props = { tags: Tag[] };

/** Parse a free-typed weight to an integer clamped to the allowed range. */
function clampWeight(raw: string): number {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return 0;
  return Math.max(-9999, Math.min(9999, n));
}

export function TagManager({ tags }: Props) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#10b981");
  const [weight, setWeight] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.addTag(name.trim().toLowerCase(), color, clampWeight(weight));
      setName("");
      setWeight("0");
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
        <input
          type="number"
          className="weight-input"
          value={weight}
          min={-9999}
          max={9999}
          aria-label="New tag weight"
          onChange={e => setWeight(e.currentTarget.value)}
        />
        <button type="submit" disabled={!name.trim()}>Add tag</button>
      </form>
      {error && <p className="composer-error">{error}</p>}
      <ul className="settings-list">
        {tags.length === 0 && <li className="settings-empty">No tags yet.</li>}
        {tags.map(t => (
          editingId === t.id
            ? <TagEditRow
                key={t.id}
                tag={t}
                onDone={() => setEditingId(null)}
                onError={setError}
              />
            : <li key={t.id}>
                <span className="color-dot" style={{ background: t.color }} />
                <span className="settings-name">#{t.name}</span>
                <span className="tag-weight" title="priority weight">{t.priority}</span>
                <button className="link-button" onClick={() => { setError(null); setEditingId(t.id); }}>edit</button>
                <button className="link-button danger" onClick={() => remove(t)}>delete</button>
              </li>
        ))}
      </ul>
    </section>
  );
}

type EditProps = { tag: Tag; onDone: () => void; onError: (e: string | null) => void };

function TagEditRow({ tag, onDone, onError }: EditProps) {
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);
  const [weight, setWeight] = useState(String(tag.priority));

  const save = async () => {
    if (!name.trim()) return;
    try {
      await api.updateTag({
        id: tag.id,
        name: name.trim().toLowerCase(),
        color,
        priority: clampWeight(weight),
      });
      onError(null);
      onDone();
    } catch (err) {
      onError(String(err));
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); void save(); }
    else if (e.key === "Escape") { e.preventDefault(); onDone(); }
  };

  // Enter/Escape are scoped to the text fields (not the row) so activating a
  // ColorPicker swatch with the keyboard doesn't also save and close the row.
  return (
    <li className="tag-edit-row">
      <ColorPicker value={color} onChange={setColor} />
      <input
        className="tag-edit-name"
        value={name}
        aria-label={`Name for #${tag.name}`}
        onChange={e => setName(e.currentTarget.value)}
        onKeyDown={onKeyDown}
        autoFocus
      />
      <input
        type="number"
        className="weight-input"
        value={weight}
        min={-9999}
        max={9999}
        aria-label={`Weight for #${tag.name}`}
        onChange={e => setWeight(e.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      <button className="link-button" onClick={save} disabled={!name.trim()}>save</button>
      <button className="link-button" onClick={onDone}>cancel</button>
    </li>
  );
}
