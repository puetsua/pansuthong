import { FormEvent, useState } from "react";
import { api, Project, Tag } from "../../lib/tauri";
import { ProjectColorPicker } from "../../components/ProjectColorPicker";

type Props = { tags: Tag[]; projects: Project[] };

export function TagManager({ tags, projects }: Props) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#10b981");
  const [projectId, setProjectId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.addTag(name.trim().toLowerCase(), color, projectId || undefined);
      setName("");
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  };

  const linkProject = async (t: Tag, newProjectId: string) => {
    try {
      if (newProjectId) await api.updateTag({ id: t.id, project_id: newProjectId });
      else              await api.clearTagProject(t.id);
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
        <ProjectColorPicker value={color} onChange={setColor} />
        <input
          value={name}
          onChange={e => setName(e.currentTarget.value)}
          placeholder="new-tag-name"
          aria-label="New tag name"
        />
        <select value={projectId} onChange={e => setProjectId(e.currentTarget.value)} aria-label="Link to project">
          <option value="">(no project)</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="submit" disabled={!name.trim()}>Add tag</button>
      </form>
      {error && <p className="composer-error">{error}</p>}
      <ul className="settings-list">
        {tags.length === 0 && <li className="settings-empty">No tags yet.</li>}
        {tags.map(t => (
          <li key={t.id}>
            <span className="project-dot" style={{ background: t.color }} />
            <span className="settings-name">#{t.name}</span>
            <select
              value={t.project_id ?? ""}
              onChange={e => linkProject(t, e.currentTarget.value)}
              aria-label={`Project for #${t.name}`}
            >
              <option value="">(free-floating)</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className="link-button danger" onClick={() => remove(t)}>delete</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
