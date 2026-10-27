import type { Position } from "unist";

/** Flip `[ ]` ↔ `[x]` for the GFM task marker inside a list item's source span. */
export function toggleTaskListMarker(notes: string, position: Position): string {
  const start = position.start.offset;
  const end = position.end.offset;
  if (start === undefined || end === undefined) return notes;

  const segment = notes.slice(start, end);
  const match = segment.match(/\[[ xX]\]/);
  if (!match || match.index === undefined) return notes;

  const markerStart = start + match.index;
  const markerEnd = markerStart + match[0].length;
  const checked = match[0] !== "[ ]";
  const replacement = checked ? "[ ]" : "[x]";
  return notes.slice(0, markerStart) + replacement + notes.slice(markerEnd);
}
