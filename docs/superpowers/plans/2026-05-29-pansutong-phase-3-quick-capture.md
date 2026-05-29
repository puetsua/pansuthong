# Pansutong Phase 3 — Quick Capture (Desktop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A global `Ctrl+Shift+N` hotkey on Windows opens a small, always-on-top capture window; typing one line (with the same `#tag` / `due` / `sched` / `!!!` smart-parse as the main composer) and pressing Enter creates a task that lands in the Inbox and instantly appears in the already-open main window.

**Architecture:** Add `tauri-plugin-global-shortcut` (desktop-only). At startup (desktop only) the app builds a hidden, decorationless, always-on-top `quick-capture` WebviewWindow pointing at a second Vite HTML entry (`quick-capture.html`). The hotkey handler shows + focuses that window and emits a `capture-focus` event. The capture UI reuses the existing TS smart-parse (`parseComposer`) and a newly-extracted shared tag-resolution helper, then calls the existing `add_task` command. Because every mutation emits `store-changed`, the main window's `useDocument` reloads automatically — no extra wiring. The capture window is created programmatically under `#[cfg(desktop)]` so Android (single-activity webview) is untouched.

**Tech Stack:** Tauri 2, `tauri-plugin-global-shortcut` v2, React 19 + TypeScript, Vite multi-entry build.

**Scope:** Desktop (Windows) only. The Android share-target intent and home-screen widget from the design spec are **deferred to a separate Phase 3b plan** (`pansutong-phase-3-quick-capture-android.md`, not yet written). Nothing in this plan touches `src-tauri/gen/android/`.

---

## Prerequisites / context (already true in the repo)

- `add_task` command exists: `src-tauri/src/commands.rs` — `pub fn add_task(input: NewTaskInput, ...) -> Result<Task>`. `NewTaskInput { title, due_date?, scheduled_date?, priority?, notes (default ""), tag_ids (default []) }`. **Takes pre-parsed fields; does NOT auto-create tags or parse text.**
- Frontend wrapper: `src/lib/tauri.ts` — `api.addTask(input: Partial<Task> & { title: string })`, `api.addTag(name, color, project_id?)`, `api.getDocument()`. Types `Task`, `Tag`, `Document` defined there.
- Smart-parse (TS): `src/state/parse.ts` — `parseComposer(input: string, todayIso: string): ParsedInput` where `ParsedInput = { title; tag_names: string[]; due_date?: string; scheduled_date?: string; priority?: Priority }`.
- Tag auto-creation currently lives **inline in** `src/components/Composer.tsx` (a `PALETTE` + `pickPaletteColor` + a `for` loop over `parsed.tag_names` calling `api.addTag`). Task 2 extracts this so the capture window can reuse it.
- `store-changed` is emitted by every Rust mutation (`commands.rs::emit_changed`) and the watcher; `src/state/store.ts` `useDocument` listens and reloads via `api.getDocument()`. **A capture-window `add_task` will refresh the main window automatically.**
- `ComposerPreview` (`src/components/ComposerPreview.tsx`) is rendered as `<ComposerPreview parsed={parsed} tagsByName={tagsByName} />` — reuse it in the capture window.
- `src/lib/dates.ts` exports `todayIso(): string`.
- `src-tauri/src/lib.rs` `run()` builds `tauri::Builder`, registers plugins `tauri_plugin_opener` + `tauri_plugin_os`, has a `.setup(...)` that manages `AppState` and starts the watcher, then `.invoke_handler(generate_handler![...])`.
- `tauri.conf.json` has one window (label `main`, 900×700). `vite.config.ts` is single-entry. `package.json` has `@tauri-apps/api` already.

Run the existing suite once to confirm a green baseline before starting:

```
cargo test --manifest-path src-tauri/Cargo.toml   # expect 44 passed
npx tsc --noEmit                                   # expect clean
npm test                                           # expect 20 passed
```

---

## Files this plan creates or modifies

| Path | Action | Responsibility |
|---|---|---|
| `src-tauri/Cargo.toml` | Modify | Add desktop-only dep `tauri-plugin-global-shortcut` |
| `src-tauri/src/lib.rs` | Modify | `#[cfg(desktop)]`: register global-shortcut plugin + hotkey; build hidden `quick-capture` window |
| `src-tauri/capabilities/quick-capture.json` | Create | Capability for the `quick-capture` window (desktop only) |
| `src/state/quickAdd.ts` | Create | Shared `TAG_PALETTE`, `pickPaletteColor`, `resolveTagIds` (extracted from Composer) |
| `src/state/quickAdd.test.ts` | Create | Unit tests for the extracted helpers |
| `src/components/Composer.tsx` | Modify | Use the extracted helper instead of inline tag logic |
| `quick-capture.html` | Create | Second Vite HTML entry for the capture window |
| `src/quick-capture/main.tsx` | Create | React entry that mounts `<QuickCapture />` |
| `src/quick-capture/QuickCapture.tsx` | Create | The capture UI (input + parse preview + save/close/clear) |
| `src/quick-capture/quick-capture.css` | Create | Styling for the small capture window |
| `vite.config.ts` | Modify | Multi-entry build (`index.html` + `quick-capture.html`) |

---

## Task 1 — Add `tauri-plugin-global-shortcut` (desktop-only dependency)

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1.1: Add the desktop-only dependency**

In `src-tauri/Cargo.toml`, add a new target-specific section **after** the existing `[dependencies]` block (do not put it inside `[dependencies]`):

```toml
[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]
tauri-plugin-global-shortcut = "2"
```

This keeps the plugin off mobile builds (global shortcuts are a desktop concept).

- [ ] **Step 1.2: Verify it resolves and nothing regressed**

```
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npx tsc --noEmit
npm test
```

Expected: cargo downloads + checks clean; 44 cargo tests pass; tsc clean; 20 vitest pass. (The plugin is added but not yet used — that's Task 5.)

- [ ] **Step 1.3: Commit**

```
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "Add tauri-plugin-global-shortcut (desktop-only)"
```

---

## Task 2 — Extract shared tag-resolution helper; refactor Composer

**Files:**
- Create: `src/state/quickAdd.ts`
- Create: `src/state/quickAdd.test.ts`
- Modify: `src/components/Composer.tsx`

- [ ] **Step 2.1: Write the failing test**

Create `src/state/quickAdd.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { TAG_PALETTE, pickPaletteColor, resolveTagIds } from "./quickAdd";
import { Tag } from "../lib/tauri";

const mkTag = (id: string, name: string): Tag => ({ id, name, color: "#000000" });

describe("pickPaletteColor", () => {
  it("is deterministic for the same seed", () => {
    expect(pickPaletteColor("work")).toBe(pickPaletteColor("work"));
  });
  it("returns a color from the palette", () => {
    expect(TAG_PALETTE).toContain(pickPaletteColor("anything"));
  });
});

describe("resolveTagIds", () => {
  it("reuses an existing tag case-insensitively and does not create it", async () => {
    const byName = new Map<string, Tag>([["work", mkTag("t_work", "work")]]);
    const addTag = vi.fn();
    const ids = await resolveTagIds(["Work"], byName, addTag);
    expect(ids).toEqual(["t_work"]);
    expect(addTag).not.toHaveBeenCalled();
  });

  it("creates an unknown tag (lowercased) with a palette color", async () => {
    const byName = new Map<string, Tag>();
    const addTag = vi.fn(async (name: string, _color: string) => mkTag("t_new", name));
    const ids = await resolveTagIds(["Errand"], byName, addTag);
    expect(ids).toEqual(["t_new"]);
    expect(addTag).toHaveBeenCalledWith("errand", pickPaletteColor("errand"));
  });

  it("preserves order across mixed existing/new tags", async () => {
    const byName = new Map<string, Tag>([["work", mkTag("t_work", "work")]]);
    const addTag = vi.fn(async (name: string) => mkTag("t_" + name, name));
    const ids = await resolveTagIds(["work", "home"], byName, addTag);
    expect(ids).toEqual(["t_work", "t_home"]);
  });
});
```

- [ ] **Step 2.2: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — `quickAdd.ts` doesn't exist (`Failed to resolve import "./quickAdd"`).

- [ ] **Step 2.3: Implement `src/state/quickAdd.ts`**

Create `src/state/quickAdd.ts`:

```ts
import { Tag } from "../lib/tauri";

/** Built-in palette for auto-created tags. */
export const TAG_PALETTE = [
  "#4338ca", "#10b981", "#f59e0b", "#ef4444",
  "#06b6d4", "#a855f7", "#ec4899", "#84cc16",
];

/** Deterministic palette color from a seed string (stable per tag name). */
export function pickPaletteColor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
  return TAG_PALETTE[Math.abs(h) % TAG_PALETTE.length];
}

/**
 * Resolve parsed #tag names to tag IDs, creating any that don't exist yet.
 * Tag matching is case-insensitive; created tags are stored lowercased.
 * `addTag` is injected (pass `api.addTag`) so this stays unit-testable
 * without the Tauri bridge.
 */
export async function resolveTagIds(
  tagNames: string[],
  tagsByName: Map<string, Tag>,
  addTag: (name: string, color: string) => Promise<Tag>,
): Promise<string[]> {
  const ids: string[] = [];
  for (const name of tagNames) {
    const key = name.toLowerCase();
    const existing = tagsByName.get(key);
    if (existing) {
      ids.push(existing.id);
    } else {
      const created = await addTag(key, pickPaletteColor(key));
      ids.push(created.id);
    }
  }
  return ids;
}
```

- [ ] **Step 2.4: Run the test to confirm it passes**

Run: `npm test`
Expected: PASS — the 3 new `quickAdd` tests pass alongside the existing 20 (23 total).

- [ ] **Step 2.5: Refactor `Composer.tsx` to use the helper**

In `src/components/Composer.tsx`:

1. Remove the local `PALETTE` constant and the `pickPaletteColor` function (the block near the bottom of the file).
2. Add the import near the other imports:

```tsx
import { resolveTagIds } from "../state/quickAdd";
```

3. Replace the inline tag-resolution loop in the submit handler:

```tsx
    const resolvedTagIds: string[] = [];
    for (const name of parsed.tag_names) {
      const existing = tagsByName.get(name.toLowerCase());
      if (existing) {
        resolvedTagIds.push(existing.id);
      } else {
        const created = await api.addTag(name.toLowerCase(), pickPaletteColor(name));
        resolvedTagIds.push(created.id);
      }
    }
```

with:

```tsx
    const resolvedTagIds = await resolveTagIds(parsed.tag_names, tagsByName, api.addTag);
```

Leave the rest of the submit handler (the `api.addTask({ ... scheduled_date: parsed.scheduled_date ?? scheduledDate ... })` call, the `setInput("")`, error handling) unchanged.

- [ ] **Step 2.6: Verify the refactor compiles and behavior is unchanged**

```
npx tsc --noEmit
npm test
```

Expected: tsc clean (no unused `pickPaletteColor`/`PALETTE`); 23 vitest pass. The main composer's tag behavior is byte-for-byte equivalent.

- [ ] **Step 2.7: Commit**

```
git add src/state/quickAdd.ts src/state/quickAdd.test.ts src/components/Composer.tsx
git commit -m "Extract shared tag-resolution helper (quickAdd) from Composer"
```

---

## Task 3 — Second Vite entry + capture window React shell (stub)

This task wires the multi-entry build and a mountable (but stub) capture component, so `npm run build` emits both HTML entries. The real UI comes in Task 4.

**Files:**
- Create: `quick-capture.html` (project root, next to `index.html`)
- Create: `src/quick-capture/main.tsx`
- Create: `src/quick-capture/QuickCapture.tsx` (stub)
- Create: `src/quick-capture/quick-capture.css` (minimal)
- Modify: `vite.config.ts`

- [ ] **Step 3.1: Create `quick-capture.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Quick Capture</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/quick-capture/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3.2: Create `src/quick-capture/quick-capture.css` (minimal placeholder)**

```css
html, body, #root { height: 100%; margin: 0; }
.quick-capture { padding: 12px; font-family: system-ui, sans-serif; }
```

- [ ] **Step 3.3: Create `src/quick-capture/QuickCapture.tsx` (stub)**

```tsx
export function QuickCapture() {
  return <div className="quick-capture">Quick Capture</div>;
}
```

- [ ] **Step 3.4: Create `src/quick-capture/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { QuickCapture } from "./QuickCapture";
import "../styles/tokens.css";
import "./quick-capture.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QuickCapture />
  </React.StrictMode>
);
```

- [ ] **Step 3.5: Make Vite emit both entries**

In `vite.config.ts`, add a `build` block to the returned config object (place it right after the `test: { ... }` block, before `clearScreen`):

```ts
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        "quick-capture": "quick-capture.html",
      },
    },
  },
```

(Rollup resolves these relative to the project root; no `path`/`__dirname` import needed.)

- [ ] **Step 3.6: Verify both entries build**

```
npx tsc --noEmit
npm run build
```

Expected: tsc clean. Vite output lists **both** `dist/index.html` and `dist/quick-capture.html`. Confirm:

```
node -e "console.log(require('fs').existsSync('dist/quick-capture.html'))"
```

Expected: `true`.

- [ ] **Step 3.7: Commit**

```
git add quick-capture.html src/quick-capture/ vite.config.ts
git commit -m "Add quick-capture as a second Vite entry (stub UI)"
```

---

## Task 4 — Implement the QuickCapture UI

**Files:**
- Modify: `src/quick-capture/QuickCapture.tsx`
- Modify: `src/quick-capture/quick-capture.css`

This is Tauri-window + IO glue (loads tags, calls `add_task`, hides its own window). The parse and tag logic it depends on are already unit-tested (Task 2 + existing `parse.test.ts`), so this task is verified by `tsc`/`build` + the Task 6 manual smoke test rather than a new unit test.

- [ ] **Step 4.1: Implement `src/quick-capture/QuickCapture.tsx`**

Replace the stub with:

```tsx
import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { api, Tag } from "../lib/tauri";
import { parseComposer } from "../state/parse";
import { resolveTagIds } from "../state/quickAdd";
import { todayIso } from "../lib/dates";
import { ComposerPreview } from "../components/ComposerPreview";

export function QuickCapture() {
  const [input, setInput] = useState("");
  const [tagsByName, setTagsByName] = useState<Map<string, Tag>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseComposer(input, todayIso()), [input]);

  // Load tags (for #tag de-dup) on mount and whenever the store changes.
  useEffect(() => {
    const loadTags = async () => {
      try {
        const doc = await api.getDocument();
        const m = new Map<string, Tag>();
        for (const t of doc.tags) m.set(t.name.toLowerCase(), t);
        setTagsByName(m);
      } catch (err) {
        setError(String(err));
      }
    };
    void loadTags();
    const unlisten = listen("store-changed", () => { void loadTags(); });
    return () => { void unlisten.then(f => f()); };
  }, []);

  // The backend emits "capture-focus" each time the hotkey re-shows the window.
  useEffect(() => {
    const focusFresh = () => {
      setInput("");
      setError(null);
      inputRef.current?.focus();
    };
    focusFresh(); // also focus on first mount
    const unlisten = listen("capture-focus", focusFresh);
    return () => { void unlisten.then(f => f()); };
  }, []);

  const save = async (closeAfter: boolean) => {
    if (!parsed.title) return;
    try {
      const tagIds = await resolveTagIds(parsed.tag_names, tagsByName, api.addTag);
      await api.addTask({
        title: parsed.title,
        due_date: parsed.due_date,
        // No today-default here (unlike the Today composer): undated tasks land in Inbox.
        scheduled_date: parsed.scheduled_date,
        priority: parsed.priority,
        tag_ids: tagIds,
      });
      setInput("");
      setError(null);
      if (closeAfter) await getCurrentWindow().hide();
    } catch (err) {
      setError(String(err));
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save(true); // plain Enter: save and close
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setInput("");
      void getCurrentWindow().hide();
    } else if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      void save(false); // rapid-fire: save and keep the window open
    }
  };

  return (
    <form className="quick-capture" onSubmit={onSubmit}>
      <input
        ref={inputRef}
        className="quick-capture-input"
        value={input}
        onChange={e => setInput(e.currentTarget.value)}
        onKeyDown={onKeyDown}
        placeholder="Quick add…  (#tag  due fri  !!)"
        aria-label="Quick capture"
      />
      <ComposerPreview parsed={parsed} tagsByName={tagsByName} />
      <div className="quick-capture-hint">
        Enter to save · Shift+Enter to keep open · Esc to cancel
      </div>
      {error && <p className="quick-capture-error">{error}</p>}
    </form>
  );
}
```

Note: verify `ComposerPreview`'s prop names against `src/components/ComposerPreview.tsx`. It is invoked in `Composer.tsx` as `<ComposerPreview parsed={parsed} tagsByName={tagsByName} />`; match that exactly. If its props differ, adapt this call site (do not change `ComposerPreview`).

- [ ] **Step 4.2: Replace `src/quick-capture/quick-capture.css` with real styles**

```css
html, body, #root {
  height: 100%;
  margin: 0;
}
body {
  background: var(--c-surface, #fff);
  color: var(--c-text, #111);
  font-family: system-ui, -apple-system, sans-serif;
  overflow: hidden;
}
.quick-capture {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  height: 100%;
  box-sizing: border-box;
}
.quick-capture-input {
  width: 100%;
  box-sizing: border-box;
  font-size: 16px;
  padding: 10px 12px;
  border: 1px solid var(--c-border, #d0d0d0);
  border-radius: 8px;
  background: var(--c-bg, #fafafa);
  color: inherit;
  outline: none;
}
.quick-capture-input:focus {
  border-color: var(--c-accent, #6366f1);
}
.quick-capture-hint {
  font-size: 0.7rem;
  color: var(--c-text-muted, #888);
}
.quick-capture-error {
  margin: 0;
  font-size: 0.75rem;
  color: var(--c-danger, #dc2626);
}
```

- [ ] **Step 4.3: Verify**

```
npx tsc --noEmit
npm run build
```

Expected: tsc clean; build emits both entries. (Runtime behavior is exercised in Task 6.)

- [ ] **Step 4.4: Commit**

```
git add src/quick-capture/QuickCapture.tsx src/quick-capture/quick-capture.css
git commit -m "Implement QuickCapture UI (parse, save/close/clear, tag auto-create)"
```

---

## Task 5 — Register the hotkey + build the hidden capture window (Rust)

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/capabilities/quick-capture.json`

- [ ] **Step 5.1: Create the capability for the capture window**

Create `src-tauri/capabilities/quick-capture.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "quick-capture",
  "description": "Quick-capture window (desktop only)",
  "platforms": ["windows", "macOS", "linux"],
  "windows": ["quick-capture"],
  "permissions": [
    "core:default",
    "core:window:allow-hide"
  ]
}
```

(`core:default` covers `invoke`/event transport so the window can call `add_task`/`add_tag`/`get_document` and `listen`. `core:window:allow-hide` lets its JS call `getCurrentWindow().hide()`. `platforms` keeps this off Android.)

- [ ] **Step 5.2: Wire the plugin, hotkey, and hidden window in `lib.rs`**

Restructure `run()` in `src-tauri/src/lib.rs` so the desktop-only plugin can be added conditionally, and create the hidden window + register the shortcut in `.setup()`. Replace the current `tauri::Builder::default()...run(...)` chain with:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init());

    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, _shortcut, event| {
                use tauri_plugin_global_shortcut::ShortcutState;
                if event.state() == ShortcutState::Pressed {
                    if let Some(win) = app.get_webview_window("quick-capture") {
                        let _ = win.show();
                        let _ = win.set_focus();
                        let _ = win.emit("capture-focus", ());
                    }
                }
            })
            .build(),
    );

    builder
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("app_data_dir resolvable");
            std::fs::create_dir_all(&data_dir).expect("create app data dir");
            let path = data_dir.join("tasks.json");
            let state = AppState::open(path.clone()).expect("open store");
            app.manage(state);

            let handle = app.handle().clone();
            match crate::sync::start(handle, path) {
                Ok(sync_handle) => {
                    app.manage(sync_handle);
                }
                Err(e) => {
                    eprintln!("warning: filesystem watcher failed to start: {e}");
                }
            }

            // Desktop quick-capture: a hidden, always-on-top window the global
            // shortcut shows. Created here (not in tauri.conf.json) so it never
            // exists on Android.
            #[cfg(desktop)]
            {
                use tauri::{WebviewUrl, WebviewWindowBuilder};
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

                WebviewWindowBuilder::new(
                    app,
                    "quick-capture",
                    WebviewUrl::App("quick-capture.html".into()),
                )
                .title("Quick Capture")
                .inner_size(480.0, 140.0)
                .decorations(false)
                .always_on_top(true)
                .visible(false)
                .skip_taskbar(true)
                .resizable(false)
                .center()
                .build()?;

                let hotkey = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyN);
                app.global_shortcut().register(hotkey)?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_document,
            commands::add_task,
            commands::update_task,
            commands::set_task_done,
            commands::delete_task,
            commands::add_project,
            commands::delete_project,
            commands::add_tag,
            commands::delete_tag,
            commands::clear_tag_project,
            commands::parse_composer,
            commands::search_tasks,
            commands::update_project,
            commands::update_tag,
            commands::update_settings,
            commands::list_conflicts,
            commands::read_conflict,
            commands::resolve_conflict,
            commands::dismiss_conflict,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Keep the existing `use` statements at the top of `lib.rs` (e.g. `use tauri::Manager;` if present) — `app.path()`, `app.manage()`, `app.handle()`, and `app.get_webview_window()` all come from `tauri::Manager`, which is already in scope for the current code. The `emit` on the window comes from `tauri::Emitter` — if `cargo check` complains about `emit` not found, add `use tauri::Emitter;` to the imports.

Note on the global-shortcut API: the snippet uses `event.state()` (method) and `app.global_shortcut().register(...)`. If `cargo check` reports a signature mismatch for this plugin version (e.g. `event.state` is a field, or `with_shortcuts(...)` is required before `with_handler`), follow the compiler's guidance to adjust — the intent is "on Ctrl+Shift+N press, show+focus+emit on the `quick-capture` window."

- [ ] **Step 5.3: Verify the desktop build compiles**

```
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: clean check (this validates the capability JSON via `tauri-build`, the plugin API usage, and the window builder); 44 cargo tests still pass.

- [ ] **Step 5.4: Confirm mobile is untouched (Android target still compiles)**

```
cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-linux-android
```

Expected: clean. The `#[cfg(desktop)]` gates mean none of the global-shortcut / capture-window code is compiled for Android. (If the Android linker env isn't configured in this shell, this check may be skipped — note it and rely on the desktop check + the Task 6 desktop smoke test.)

- [ ] **Step 5.5: Commit**

```
git add src-tauri/src/lib.rs src-tauri/capabilities/quick-capture.json
git commit -m "Add Ctrl+Shift+N global hotkey + hidden quick-capture window (desktop)"
```

---

## Task 6 — Manual smoke test (desktop)

**Files:** none (verification only)

> The dev server + native window must be run by the user in a real terminal (a backgrounded `tauri dev` detaches its window). Ask the user to run these steps, or run them yourself if you have an attached desktop session.

- [ ] **Step 6.1: Launch desktop dev**

```
npm run tauri dev
```

Wait for the main Pansutong window.

- [ ] **Step 6.2: Trigger and capture**

1. Press **`Ctrl+Shift+N`** (from anywhere). The small capture window appears, centered, always-on-top, decorationless, with the input focused.
2. Type `#errand buy milk` and press **Enter**.
3. The capture window hides. In the main window, **buy milk** appears in **Inbox** with an auto-created `errand` tag (a palette color). It is NOT in Today (no scheduled date).

- [ ] **Step 6.3: Rapid-fire + cancel**

1. `Ctrl+Shift+N`, type `call dentist due tomorrow`, press **Shift+Enter** → task saves, input clears, window stays open.
2. Type `#work prep deck !!`, press **Enter** → saves & closes; appears with high priority + `work` tag.
3. `Ctrl+Shift+N`, type some text, press **Esc** → window hides, nothing saved.

- [ ] **Step 6.4: Confirm live refresh**

The main window updates **without** a manual refresh each time (driven by `store-changed`). Inbox/Today counts reflect the new tasks.

- [ ] **Step 6.5: No commit** — verification only. If anything fails, STOP and report the exact symptom.

---

## Done

After this plan: a global `Ctrl+Shift+N` opens an instant capture window on Windows; one line of smart-parsed text (tags auto-created) becomes an Inbox task that shows up live in the main app. The same `add_task`/parse path the main composer uses is reused, and a shared `quickAdd` helper removes the duplicated tag logic.

## Deferred to Phase 3b (separate plan — Android quick capture)

- **Share-target intent**: add a `SEND`/`text/plain` `<intent-filter>` to `MainActivity` in `gen/android/.../AndroidManifest.xml`, and deliver the shared text into the webview (open the composer pre-filled).
- **Home-screen widget**: 1×1 `AppWidgetProvider` (Kotlin) that opens the app to the composer.
Both reuse `add_task` + the same smart-parse, and the `quickAdd` helper extracted in Task 2.

## Self-review (checked against the spec's "Quick capture → Desktop" section)

- Hotkey `Ctrl+Shift+N` via `tauri-plugin-global-shortcut` → Task 1 + Task 5. ✓
- Always-on-top, decorationless, separate webview window (`quick-capture.html`), ~480×130 → Task 3 (entry) + Task 5 (window, 480×140). ✓
- One input, inline smart-parse (`#tag`, `due`, `sched`, `!`/`!!`/`!!!`) → Task 4 reuses `parseComposer`. ✓
- Tag auto-creation for unknown `#word` with round-robin palette color → Task 2 (`resolveTagIds`/`pickPaletteColor`) used in Task 4. ✓
- Captured task lands in **Inbox** unless input says otherwise → Task 4 passes `scheduled_date: parsed.scheduled_date` (no today-default), so an undated, untagged task has no project-linked tag → Inbox. ✓
- Enter = save & close; Shift+Enter = save & clear (rapid-fire); Esc = cancel → Task 4 `onSubmit`/`onKeyDown`. ✓
- One shared `add_task` command across composer + capture → reused via `api.addTask`. ✓
- Vite multi-entry (`index.html` + `quick-capture/index.html`) → Task 3 (kept at repo root as `quick-capture.html`). ✓
- `capabilities/quick-capture.json` for the capture window → Task 5. ✓
- (Spec mentioned the capture window path as `quick-capture/index.html`; this plan uses root-level `quick-capture.html` for a simpler Vite multi-entry — functionally identical.)
