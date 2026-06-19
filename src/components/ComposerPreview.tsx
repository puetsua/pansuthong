import { useTranslation } from "react-i18next";
import { Tag } from "../lib/tauri";
import { ParsedInput } from "../state/parse";
import { formatEstimatedSecondsInput } from "../state/taskUpdate";

type Props = {
  parsed: ParsedInput;
  tagsByName: Map<string, Tag>;
};

export function ComposerPreview({ parsed, tagsByName }: Props) {
  const { t } = useTranslation();
  const anything =
    parsed.tag_names.length > 0 ||
    parsed.due_date ||
    parsed.start_date ||
    parsed.estimated_seconds != null;
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
            #{name}{isNew && <span className="composer-new">{t("composerPreview.new")}</span>}
          </span>
        );
      })}
      {parsed.start_date && <span className="composer-chip">{t("composerPreview.start", { date: parsed.start_date.slice(5) })}</span>}
      {parsed.due_date       && <span className="composer-chip">{t("composerPreview.due", { date: parsed.due_date.slice(5) })}</span>}
      {parsed.estimated_seconds != null && <span className="composer-chip">{t("composerPreview.estimate", { duration: formatEstimatedSecondsInput(parsed.estimated_seconds) })}</span>}
    </div>
  );
}
