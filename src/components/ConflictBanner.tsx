import { Link } from "react-router-dom";
import { useConflicts } from "../state/conflicts";

export function ConflictBanner() {
  const files = useConflicts();
  if (files.length === 0) return null;

  const first = files[0];
  const filename = first.split(/[\\/]/).pop() ?? first;

  return (
    <div className="conflict-banner" role="alert">
      <span>
        {files.length === 1
          ? `1 sync conflict — ${filename}`
          : `${files.length} sync conflicts`}
      </span>
      <Link className="conflict-banner-link" to={`/conflicts/${encodeURIComponent(first)}`}>
        Review →
      </Link>
    </div>
  );
}
