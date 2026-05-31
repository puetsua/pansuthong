import { FormEvent, useMemo, useState } from "react";
import { api, Tag } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { parseComposer } from "../state/parse";
import { todayIso } from "../lib/dates";
import { ComposerPreview } from "./ComposerPreview";
import { resolveTagIds } from "../state/quickAdd";

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
      const resolvedTagIds = await resolveTagIds(parsed.tag_names, tagsByName, api.addTag);

      await api.addTask({
        title: parsed.title,
        scheduled_date: parsed.scheduled_date ?? scheduledDate,
        due_date: parsed.due_date,
        tag_ids: resolvedTagIds,
      });
      setInput("");
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div>
      <form className="composer" onSubmit={submit}>
        <input
          value={input}
          onChange={e => setInput(e.currentTarget.value)}
          placeholder="What needs doing?  (try: #work due fri Reply to Anna)"
          aria-label="New task"
        />
        <button type="submit" disabled={!parsed.title}>Add</button>
        {error && <p className="composer-error">{error}</p>}
      </form>
      <ComposerPreview parsed={parsed} tagsByName={tagsByName} />
    </div>
  );
}
