import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useConflicts } from "../state/conflicts";

export function ConflictBanner() {
  const { t } = useTranslation();
  const files = useConflicts();
  if (files.length === 0) return null;

  const first = files[0];
  const filename = first.split(/[\\/]/).pop() ?? first;

  return (
    <div className="conflict-banner" role="alert">
      <span>
        {files.length === 1
          ? t("conflictBanner.one", { filename })
          : t("conflictBanner.many", { count: files.length })}
      </span>
      <Link className="conflict-banner-link" to={`/conflicts/${encodeURIComponent(first)}`}>
        {t("conflictBanner.review")}
      </Link>
    </div>
  );
}
