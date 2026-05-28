import { FormEvent, useMemo, useState } from "react";
import { api, Tag } from "../lib/tauri";
import { parseComposer } from "../state/parse";
import { todayIso } from "../lib/dates";
import { ComposerPreview } from "./ComposerPreview";

type Props = {
  scheduledDate?: string;
  tagsByName: Map<string, Tag>;
};

export function Composer({ scheduledDate, tagsByName }: Props) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseComposer(input, todayIso()), [input]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!parsed.title) return;

    try {
      const resolvedTagIds: string[] = [];
      for (const name of parsed.tag_names) {
        const existing = tagsByName.get(name.toLowerCase());
        if (existing) {
          resolvedTagIds.push(existing.id);
        } else {
          const created = await api.addTag(name.toLowerCase(), pickPaletteColor(name));
          resolvedTagIds.push(created.id);
        }
      }

      await api.addTask({
        title: parsed.title,
        scheduled_date: parsed.scheduled_date ?? scheduledDate,
        due_date: parsed.due_date,
        priority: parsed.priority,
        tag_ids: resolvedTagIds,
      });
      setInput("");
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div>
      <form className="composer" onSubmit={submit}>
        <input
          value={input}
          onChange={e => setInput(e.currentTarget.value)}
          placeholder="What needs doing?  (try: #work due fri !! Reply to Anna)"
          aria-label="New task"
        />
        <button type="submit" disabled={!parsed.title}>Add</button>
        {error && <p className="composer-error">{error}</p>}
      </form>
      <ComposerPreview parsed={parsed} tagsByName={tagsByName} />
    </div>
  );
}

const PALETTE = ["#4338ca", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7", "#ec4899", "#84cc16"];
function pickPaletteColor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}
