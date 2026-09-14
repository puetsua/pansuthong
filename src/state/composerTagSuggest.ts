import type { Tag } from "../lib/tauri";

/** Caret is inside an in-progress `#tag` or `#"quoted tag"` token in the composer. */
export type ActiveTagFragment = {
  /** Index of the `#` that starts this token. */
  start: number;
  /** Exclusive end of the whole token (whitespace boundary or closing `"`). */
  tokenEnd: number;
  /** Fragment text used for filtering — unquoted body or inside opening `#"`. */
  rawFragment: string;
};

export type ComposerTagOption =
  | { kind: "create"; name: string }
  | { kind: "existing"; tag: Tag };

const byWeightDesc = (a: Tag, b: Tag) => b.priority - a.priority;

/** End of the whitespace-delimited token that begins at `tokenStart`. */
export function tokenEndAt(input: string, tokenStart: number): number {
  if (tokenStart >= input.length || input[tokenStart] !== "#") return tokenStart;

  if (input[tokenStart + 1] === '"') {
    const close = input.indexOf('"', tokenStart + 2);
    return close >= 0 ? close + 1 : input.length;
  }

  let end = tokenStart + 1;
  while (end < input.length && !/\s/.test(input[end])) end++;
  return end;
}

/**
 * When the caret sits inside an incomplete or editable `#…` tag token, return its
 * span and the typed fragment used for typeahead. Returns null outside `#` tokens
 * or when the caret is past a fully closed `#"…"` quoted tag.
 */
export function getActiveTagFragment(input: string, caret: number): ActiveTagFragment | null {
  if (caret < 0 || caret > input.length) return null;

  let search = caret;
  while (search >= 0) {
    const hash = input.lastIndexOf("#", search);
    if (hash < 0) return null;

    const tokenEnd = tokenEndAt(input, hash);
    if (caret >= hash && caret <= tokenEnd) {
      const token = input.slice(hash, tokenEnd);

      if (token.startsWith('#"')) {
        const closed = token.endsWith('"') && token.length > 2;
        if (closed) return null;
        const rawFragment = input.slice(hash + 2, caret);
        return { start: hash, tokenEnd, rawFragment };
      }

      const rawFragment = input.slice(hash + 1, caret);
      return { start: hash, tokenEnd, rawFragment };
    }

    search = hash - 1;
  }

  return null;
}

/** Composer inline token for a tag name (mirrors quick-add `#word` / `#"phrase"` rules). */
export function formatComposerTagToken(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "#";
  if (/^\S+$/.test(trimmed)) return `#${trimmed}`;
  return `#"${trimmed.replace(/"/g, "")}"`;
}

export function buildComposerTagOptions(
  allTags: Iterable<Tag>,
  rawFragment: string,
): ComposerTagOption[] {
  const raw = rawFragment;
  const q = raw.trim().toLowerCase();
  const matching = [...allTags]
    .filter(t => !q || t.name.toLowerCase().includes(q))
    .sort(byWeightDesc);

  const nameTaken =
    q.length > 0
    && [...allTags].some(t => t.name.toLowerCase() === q);

  const showCreate = q.length > 0 && !nameTaken;
  const createName = raw.trim();

  const options: ComposerTagOption[] = [];
  if (showCreate) options.push({ kind: "create", name: createName });
  options.push(...matching.map((tag): ComposerTagOption => ({ kind: "existing", tag })));
  return options;
}

export function replaceComposerTagToken(
  input: string,
  fragment: ActiveTagFragment,
  tagName: string,
): { value: string; caret: number } {
  const token = formatComposerTagToken(tagName);
  const value = input.slice(0, fragment.start) + token + input.slice(fragment.tokenEnd);
  return { value, caret: fragment.start + token.length };
}
