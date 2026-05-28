import { Document, Project, Tag, Task } from "../lib/tauri";
import { isoLt } from "../lib/dates";

export type Indexes = {
  byProject: Map<string, Task[]>;
  byTag:     Map<string, Task[]>;
  tagToProject: Map<string, string>;
  today:     (todayIso: string) => Task[];
  inbox:     Task[];
  projectsById: Map<string, Project>;
  tagsById:     Map<string, Tag>;
  tagsByName:   Map<string, Tag>;
  tasks:        Task[];
};

export function buildIndexes(doc: Document): Indexes {
  const tagToProject = new Map<string, string>();
  for (const tag of doc.tags) {
    if (tag.project_id) tagToProject.set(tag.id, tag.project_id);
  }

  const byProject = new Map<string, Task[]>();
  const byTag     = new Map<string, Task[]>();
  for (const project of doc.projects) byProject.set(project.id, []);
  for (const tag of doc.tags)         byTag.set(tag.id, []);

  for (const task of doc.tasks) {
    for (const tagId of task.tag_ids) {
      byTag.get(tagId)?.push(task);
      const pid = tagToProject.get(tagId);
      if (pid) byProject.get(pid)?.push(task);
    }
  }

  const inbox = doc.tasks.filter(t =>
    t.tag_ids.every(tid => !tagToProject.has(tid))
  );

  const projectsById = new Map(doc.projects.map(p => [p.id, p]));
  const tagsById     = new Map(doc.tags.map(t => [t.id, t]));

  const tagsByName = new Map<string, Tag>();
  for (const t of doc.tags) tagsByName.set(t.name.toLowerCase(), t);

  const today = (todayIso: string): Task[] => doc.tasks.filter(t => {
    if (t.scheduled_date === todayIso) return true;
    if (t.due_date) {
      if (t.due_date === todayIso) return true;
      if (isoLt(t.due_date, todayIso) && !t.done) return true;
    }
    return false;
  });

  return { byProject, byTag, tagToProject, today, inbox, projectsById, tagsById, tagsByName, tasks: doc.tasks };
}
