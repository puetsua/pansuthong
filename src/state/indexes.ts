import { Document, Tag, Task } from "../lib/tauri";
import { isoLt } from "../lib/dates";

export type Indexes = {
  byTag:     Map<string, Task[]>;
  today:     (todayIso: string) => Task[];
  inbox:     Task[];
  tagsById:     Map<string, Tag>;
  tagsByName:   Map<string, Tag>;
  tasks:        Task[];
};

export function buildIndexes(doc: Document): Indexes {
  const byTag = new Map<string, Task[]>();
  for (const tag of doc.tags) byTag.set(tag.id, []);

  for (const task of doc.tasks) {
    for (const tagId of task.tag_ids) {
      byTag.get(tagId)?.push(task);
    }
  }

  const inbox = doc.tasks.filter(t => t.tag_ids.length === 0);

  const tagsById = new Map(doc.tags.map(t => [t.id, t]));

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

  return { byTag, today, inbox, tagsById, tagsByName, tasks: doc.tasks };
}
