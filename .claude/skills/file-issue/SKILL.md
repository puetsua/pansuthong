---
name: file-issue
description: Investigate, reproduce, and file a GitHub issue for a problem the user found while testing Pansutong (desktop or Android). Use whenever the user reports a bug, defect, glitch, missing behavior, or improvement they noticed in the app — e.g. "I found that…", "when I click X, Y happens", "the task list doesn't…", "on desktop it…". Verify reproducibility from the code/app BEFORE filing; do not fix it.
---

# File a GitHub issue from a user finding

The user is testing Pansutong and reports things they find. For each finding: **investigate it, confirm it's real and reproducible, then file one issue.** Do not fix the problem — the goal here is a clean, reproducible bug report, not a patch.

Repo: `puetsua/pansutong` (use `gh`, already authenticated). One issue **per distinct finding** — if the user batches several, split them.

## Workflow per finding

### 1. Understand the claim
Restate what the user observed in your own words. Note the platform (desktop / Android) and the exact trigger. If the report is too vague to investigate or reproduce (no clear action, no observable symptom), ask one focused clarifying question before digging — don't guess.

### 2. Investigate the code
Trace the relevant path before touching the app. Frontend lives in `src/`, Rust commands in `src-tauri/src/lib.rs`. Find the component, command, or state that owns the behavior and read it. The aim is to (a) confirm the mechanism that produces the symptom, and (b) gather precise `file:line` references for the issue body.

### 3. Reproduce / verify
Confirm the behavior is real — don't take the symptom on faith, and don't file from a hunch.

- **Prefer running the app** when the bug is interactive (UI state, persistence, a click flow). Use the `run-dev` skill to launch the right target, then drive the repro. Persisted data lives in `app_data_dir()/tasks.json` — inspect it when the bug involves saved tasks.
- **Code-trace verification** is enough when the path is unambiguous (e.g. an obvious logic error you can point to in `lib.rs`). Say so explicitly: "verified by code inspection at `lib.rs:NN`."
- If you **can't reproduce it**, do NOT file. Tell the user what you tried, what you saw instead, and ask for more detail (exact steps, screenshot, their tasks.json state). A vague unverified issue is worse than none.

### 4. File the issue
Only after the finding is confirmed. Use the template below and pick a label:

- `bug` — something is broken or behaves wrong.
- `enhancement` — missing feature or an improvement to working behavior.
- `documentation` / `question` — only if it clearly fits better than the two above.

```bash
gh issue create --repo puetsua/pansutong \
  --title "<concise, specific summary>" \
  --label "<label>" \
  --body "<body from template>"
```

Always **identify the filer** in the issue body so a human reading the tracker knows it was filed by an automated agent, not hand-written. Append the attribution footer (see template) naming the app (Claude Code) and the model. Use the model ID from your environment context.

After it's created, report the issue number and URL back to the user.

## Issue body template

```markdown
## Summary
<one or two sentences: what's wrong and where>

## Platform
Desktop (Windows)  <!-- or Android -->

## Steps to reproduce
1. …
2. …

## Expected
<what should happen>

## Actual
<what happens instead>

## Verification
<how you confirmed it: "Reproduced live via npm run tauri dev" and/or "code inspection at src/...:NN, src-tauri/src/lib.rs:NN">

## Notes
<relevant code references, tasks.json state, or anything that helps whoever fixes it. Omit if none.>

---
🤖 Filed by Claude Code (model: <model-id, e.g. claude-opus-4-8>) on behalf of @<github-user>.
```

## Don't

- Don't fix the bug or open a PR — filing only, unless the user explicitly asks for a fix afterward.
- Don't file something you couldn't reproduce or trace to a concrete cause.
- Don't merge two unrelated findings into one issue.
