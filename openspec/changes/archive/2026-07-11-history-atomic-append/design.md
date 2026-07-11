## Context

`append_history` opens with append mode and writes lines. Crash can leave a partial last line.

## Goals / Non-Goals

**Goals:** Prior history survives a crash mid-append; at worst the in-flight batch is lost.

**Non-Goals:** Changing history semantics, SQLite migration (#126), peer-merge append (#124).

## Decisions

### D1: Temp file + rename in the same directory

1. Write `history_<device>.jsonl.tmp` with previous contents (if any) plus new lines
2. Flush + sync the temp file
3. Rename over `history_<device>.jsonl` (atomic on same volume)

**Alternative:** O_APPEND with careful framing — still allows torn last line on some platforms. Rejected.

### D2: Keep torn-line skip on read

Defense in depth for files written by older builds.

## Risks / Trade-offs

- [Large history files rewrite on every append] → Acceptable for typical sizes; can segment later if needed
- [Rename not atomic on every FS] → Best effort; same pattern as `db::snapshot`

## Open Questions

None.
