import dayjs from "dayjs";
import { Priority } from "../lib/tauri";

export type ParsedInput = {
  title: string;
  tag_names: string[];
  due_date?: string;       // YYYY-MM-DD
  scheduled_date?: string; // YYYY-MM-DD
  priority?: Priority;
};

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WEEKDAY_ALIASES: Record<string, number> = {
  monday: 1, tuesday: 2, tues: 2, wednesday: 3, weds: 3,
  thursday: 4, thur: 4, thurs: 4, friday: 5, saturday: 6, sunday: 0,
};

/** Mirror of Rust `parse.rs`. Kept in sync via parallel test suites. */
export function parseComposer(input: string, todayIso: string): ParsedInput {
  const out: ParsedInput = { title: "", tag_names: [] };
  const tokens = input.split(/\s+/).filter(Boolean);
  const titleParts: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    if (tok.startsWith("#") && tok.length > 1) {
      out.tag_names.push(tok.slice(1));
      continue;
    }
    const bangs = leadingBangs(tok);
    if (bangs > 0) {
      out.priority = bangs >= 3 ? "high" : bangs === 2 ? "med" : "low";
      const rest = tok.slice(bangs);
      if (rest) titleParts.push(rest);
      continue;
    }
    if ((tok === "due" || tok === "sched" || tok === "scheduled") && i + 1 < tokens.length) {
      const date = parseDateWord(tokens[i + 1], todayIso);
      if (date) {
        if (tok === "due") out.due_date = date;
        else                out.scheduled_date = date;
        i++; // consume the date word
        continue;
      }
    }
    titleParts.push(tok);
  }

  out.title = titleParts.join(" ").trim();
  return out;
}

function leadingBangs(tok: string): number {
  let n = 0;
  while (n < tok.length && tok[n] === "!") n++;
  return n;
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

  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) {
    const d = dayjs(w, "YYYY-MM-DD");
    if (d.isValid()) return w;
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
