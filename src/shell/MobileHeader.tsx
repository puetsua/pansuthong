import { Link, useLocation } from "react-router-dom";
import { Indexes } from "../state/indexes";

type Props = { indexes: Indexes };

const ROUTE_TITLES: Record<string, string> = {
  "/today":    "Today",
  "/inbox":    "Inbox",
  "/upcoming": "Upcoming",
  "/search":   "Search",
  "/tags":     "Tags",
  "/settings": "Settings",
};

export function MobileHeader({ indexes }: Props) {
  const loc = useLocation();
  const title = pickTitle(loc.pathname, indexes);

  return (
    <header className="mobile-header">
      <h1 className="mobile-title">{title}</h1>
      <div className="mobile-header-actions">
        <Link to="/tags" className="mobile-header-icon" aria-label="Tags">#</Link>
        <Link to="/settings" className="mobile-header-icon" aria-label="Settings">⚙</Link>
      </div>
    </header>
  );
}

function pickTitle(pathname: string, indexes: Indexes): string {
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname];
  const tagMatch = pathname.match(/^\/tag\/(.+)$/);
  if (tagMatch) {
    const tag = indexes.tagsById.get(tagMatch[1]);
    return tag ? `#${tag.name}` : "Tag";
  }
  if (pathname.startsWith("/conflicts/")) return "Conflict";
  return "Pansutong";
}
