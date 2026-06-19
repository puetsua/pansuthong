import dayjs from "dayjs";
import { ESTIMATED_SECONDS_MAX, parseEstimatedSeconds } from "./taskUpdate";

export type ParsedInput = {
  title: string;
  tag_names: string[];
  due_date?: string;   // YYYY-MM-DD
  start_date?: string; // YYYY-MM-DD
  estimated_seconds?: number; // whole seconds; absent = no estimate
};

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WEEKDAY_ALIASES: Record<string, number> = {
  monday: 1, tuesday: 2, tues: 2, wednesday: 3, weds: 3,
  thursday: 4, thur: 4, thurs: 4, friday: 5, saturday: 6, sunday: 0,
};

/** Mirror of Rust `parse.rs`. Kept in sync via parallel test suites. */
export function parseComposer(input: string, todayIso: string): ParsedInput {
  const out: ParsedInput = { title: "", tag_names: [] };
  // A `#"…"` run is one token (spaces and all); everything else is a non-space run.
  // The optional closing quote lets an unterminated `#"foo bar` reach end-of-input.
  const tokens = input.match(/#"[^"]*"?|\S+/g) ?? [];
  const titleParts: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    const tagName = tagFromToken(tok);
    if (tagName !== null) {
      out.tag_names.push(tagName);
      continue;
    }
    // `~1h30m` / `~45m` / `~30` (bare = minutes) sets the estimate; last one wins.
    // The same duration grammar as the editor's estimate field. An unparseable or
    // out-of-range `~token` falls through to the title (like a bad `due` word).
    const est = estimateFromToken(tok);
    if (est !== null) {
      out.estimated_seconds = est;
      continue;
    }
    // "start" is the current keyword; "sched"/"scheduled" stay as aliases (#renamed).
    if ((tok === "due" || tok === "start" || tok === "sched" || tok === "scheduled") && i + 1 < tokens.length) {
      const date = parseDateWord(tokens[i + 1], todayIso);
      if (date) {
        if (tok === "due") out.due_date = date;
        else                out.start_date = date;
        i++; // consume the date word
        continue;
      }
    }
    titleParts.push(tok);
  }

  out.title = titleParts.join(" ").trim();
  return out;
}

/**
 * A tag name from a token, or null if the token isn't a tag (no `#`, or an empty
 * name like a bare `#` / `#""`). `#"phrase with spaces"` unwraps the quotes;
 * `#word` keeps its existing meaning. Names are trimmed of surrounding whitespace.
 */
function tagFromToken(tok: string): string | null {
  if (!tok.startsWith("#")) return null;
  let rest = tok.slice(1);
  if (rest.startsWith('"')) {
    rest = rest.endsWith('"') && rest.length >= 2 ? rest.slice(1, -1) : rest.slice(1);
  }
  const name = rest.trim();
  return name.length > 0 ? name : null;
}

/**
 * Seconds from a `~duration` token, or null if the token isn't a valid estimate
 * (no `~`, empty, unparseable, or outside 1..=ESTIMATED_SECONDS_MAX). Reuses the
 * editor's duration grammar so `~1h30m` and the estimate field agree.
 */
function estimateFromToken(tok: string): number | null {
  if (!tok.startsWith("~")) return null;
  const seconds = parseEstimatedSeconds(tok.slice(1));
  if (seconds == null || !Number.isInteger(seconds) || seconds < 1 || seconds > ESTIMATED_SECONDS_MAX) {
    return null;
  }
  return seconds;
}

function parseDateWord(word: string, todayIso: string): string | undefined {
  const w = word.toLowerCase();
  const today = dayjs(todayIso);

  if (w === "today")                                return todayIso;
  if (w === "tomorrow" || w === "tmr" || w === "tom") return today.add(1, "day").format("YYYY-MM-DD");

  const wdNum = weekdayNumber(w);
  if (wdNum !== undefined) {
    const todayWd = today.day();
    let delta = (wdNum - todayWd + 7) % 7;
    if (delta === 0) delta = 7;
    return today.add(delta, "day").format("YYYY-MM-DD");
  }

  const iso = w.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const y = parseInt(iso[1], 10);
    const m = parseInt(iso[2], 10);
    const d = parseInt(iso[3], 10);
    // Explicit calendar validation. `dayjs(w, "YYYY-MM-DD")` is a no-op without
    // the customParseFormat plugin, so it can't reject e.g. 2026-13-05 / 2026-02-30.
    // A native Date round-trips only for real dates (overflow rolls the fields).
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d) {
      return w;
    }
    return undefined;
  }
  const md = w.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (md) {
    const m = parseInt(md[1], 10);
    const d = parseInt(md[2], 10);
    if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
    const candidate = today.month(m - 1).date(d);
    if (candidate.month() !== m - 1 || candidate.date() !== d) return undefined;
    if (candidate.isValid()) return candidate.format("YYYY-MM-DD");
  }
  return undefined;
}

function weekdayNumber(w: string): number | undefined {
  const idx = WEEKDAYS.indexOf(w);
  if (idx >= 0) return idx;
  if (WEEKDAY_ALIASES[w] !== undefined) return WEEKDAY_ALIASES[w];
  return undefined;
}
