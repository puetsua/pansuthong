import { Tag } from "../lib/tauri";
import { ParsedInput } from "../state/parse";

type Props = {
  parsed: ParsedInput;
  tagsByName: Map<string, Tag>;
};

export function ComposerPreview({ parsed, tagsByName }: Props) {
  const anything =
    parsed.tag_names.length > 0 ||
    parsed.due_date ||
    parsed.scheduled_date;
  if (!anything) return null;

  return (
    <div className="composer-preview">
      {parsed.tag_names.map(name => {
        const existing = tagsByName.get(name.toLowerCase());
        const color = existing?.color ?? "var(--c-text-muted)";
        const isNew = !existing;
        return (
          <span key={name} className="composer-chip"
                style={{ background: color + "22", color }}>
            #{name}{isNew && <span className="composer-new">new</span>}
          </span>
        );
      })}
      {parsed.scheduled_date && <span className="composer-chip">sched {parsed.scheduled_date.slice(5)}</span>}
      {parsed.due_date       && <span className="composer-chip">due {parsed.due_date.slice(5)}</span>}
    </div>
  );
}
