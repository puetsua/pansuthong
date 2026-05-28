import { FormEvent, useState } from "react";
import { api, Project } from "../../lib/tauri";
import { ProjectColorPicker } from "../../components/ProjectColorPicker";

type Props = { projects: Project[] };

export function ProjectManager({ projects }: Props) {
  const [name, setName]   = useState("");
  const [color, setColor] = useState("#4338ca");
  const [error, setError] = useState<string | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.addProject(name.trim(), color);
      setName("");
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  };

  const rename = async (p: Project) => {
    const next = window.prompt("Rename project:", p.name);
    if (!next || next.trim() === p.name) return;
    try { await api.updateProject({ id: p.id, name: next.trim() }); }
    catch (err) { setError(String(err)); }
  };

  const remove = async (p: Project) => {
    if (!window.confirm(`Delete project "${p.name}"? Linked tags become free-floating.`)) return;
    try { await api.deleteProject(p.id); }
    catch (err) { setError(String(err)); }
  };

  return (
    <section className="settings-section">
      <h2>Projects</h2>
      <form className="settings-row" onSubmit={add}>
        <ProjectColorPicker value={color} onChange={setColor} />
        <input
          value={name}
          onChange={e => setName(e.currentTarget.value)}
          placeholder="New project name"
          aria-label="New project name"
        />
        <button type="submit" disabled={!name.trim()}>Add project</button>
      </form>
      {error && <p className="composer-error">{error}</p>}
      <ul className="settings-list">
        {projects.length === 0 && <li className="settings-empty">No projects yet.</li>}
        {projects.map(p => (
          <li key={p.id}>
            <span className="project-dot" style={{ background: p.color }} />
            <span className="settings-name">{p.name}</span>
            <button className="link-button" onClick={() => rename(p)}>rename</button>
            <button className="link-button danger" onClick={() => remove(p)}>delete</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
