# Pansutong Phase 4 — Android (Local-Only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working Pansutong APK that runs on Android, with a mobile-friendly bottom-tab shell. Storage stays at the default app-private location; cross-device sync via SAF/Syncthing is **deferred to Phase 4B** (not in this plan).

**Architecture:** The existing Rust core is already `#[cfg_attr(mobile, ...)]`-compatible and uses `app_data_dir()` (which resolves to app-private storage on Android). No structural changes are needed in `model.rs`, `store.rs`, `commands.rs`, or `conflict.rs`. `sync.rs` keeps `notify` for the app-private path — Android's inotify backend works fine for files inside the app's own data dir. The frontend grows a `MobileShell` (bottom tab bar + top header) selected via a viewport media query; the existing `DesktopShell` is rendered when there's room.

**Tech Stack additions:**
- `@tauri-apps/plugin-os` (frontend) — platform detection (optional; fallback is viewport-only). **NEW JS dep.**
- `tauri-plugin-os` (Rust) — companion crate for the JS plugin. **NEW Rust dep.**

**Prerequisites:**
- Android Studio + SDK installed; `ANDROID_HOME` set.
- NDK installed at a versioned path; `NDK_HOME` points at it (e.g. `$ANDROID_HOME/ndk/27.0.12077973`).
- JDK 21 installed; `JAVA_HOME` points at it. (Phase 1 noted JDK 25 may not work with Gradle.)
- Rust Android targets:
  ```
  rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android i686-linux-android
  ```
- A connected device (USB debugging enabled) OR an Android emulator AVD. `adb devices` lists it.

If anything above fails, **invoke the `/setup-tauri-android` skill before continuing** and only return to this plan when all five lines below print successfully:

```
cargo --version
rustup target list --installed | grep android
javac -version              # should show 21
echo $env:ANDROID_HOME      # non-empty
echo $env:NDK_HOME          # non-empty, ends in a version dir
```

---

## Scope and non-goals

**In:**
- `tauri android init` generates `src-tauri/gen/android/`.
- Mobile-responsive shell (bottom tabs on narrow viewports; sidebar on wide).
- Touch-friendly tap targets; safe-area handling for notch/gesture-area phones.
- Cargo + Tauri build for an Android-target APK.

**Out (deferred to other plans):**
- **SAF folder picker / external storage** — `pansutong-phase-4b-saf-sync.md` (not yet written).
- **Share-target intent** for quick capture — part of `pansutong-phase-3-quick-capture.md`.
- **Home-screen widget** — also `pansutong-phase-3-quick-capture.md`.
- **Cross-device sync on Android** — without SAF, you'd need root or `Syncthing-Fork` shenanigans. Practically: defer to 4B.

After this plan ships, the app runs on Android as a standalone task tracker. Syncing happens only on the desktop side; the phone is a local-only client until Phase 4B.

---

## Files this plan creates or modifies

### Rust (under `src-tauri/`)

| Path | Action | Responsibility |
|---|---|---|
| `Cargo.toml` | Modify | Add `tauri-plugin-os = "2"` |
| `src/lib.rs` | Modify | Register `tauri_plugin_os::init()` plugin |
| `tauri.conf.json` | Modify (probably auto) | Confirm `bundle.android.minSdkVersion` ≥ 24 |
| `gen/android/` | Created by `tauri android init` | Generated Gradle project — checked in |

### Frontend (under `src/`)

| Path | Action | Responsibility |
|---|---|---|
| `../index.html` | Modify | Add `viewport-fit=cover` to the viewport meta |
| `../package.json` | Modify | Add `@tauri-apps/plugin-os` |
| `lib/viewport.ts` | Create | `useMediaQuery` and `useIsMobile` hooks |
| `shell/MobileShell.tsx` | Create | Top header + main pane + bottom tab bar |
| `shell/MobileHeader.tsx` | Create | Title + gear-icon → /settings |
| `shell/BottomTabs.tsx` | Create | Today / Inbox / Upcoming / Search |
| `App.tsx` | Modify | Pick DesktopShell vs MobileShell based on viewport |
| `styles/global.css` | Modify | Mobile shell styles + safe-area + larger touch targets at narrow widths |

---

## Task 1 — Verify Android toolchain (no code changes)

**Files:** none

- [ ] **Step 1.1: Run the prereq checks**

In a PowerShell terminal:

```pwsh
cargo --version
rustc --version
rustup target list --installed | Select-String android
javac -version
adb --version
"$env:ANDROID_HOME"
"$env:NDK_HOME"
"$env:JAVA_HOME"
Test-Path "$env:ANDROID_HOME\platform-tools\adb.exe"
Test-Path "$env:NDK_HOME\source.properties"
```

All must succeed and the four `android` targets must appear in the `rustup` list. If any of those checks fail, **STOP, invoke `/setup-tauri-android`, and re-run this step before proceeding.**

- [ ] **Step 1.2: Confirm a device or emulator is reachable**

```
adb devices
```

Expected: one or more device IDs listed (your phone over USB OR an AVD started in Android Studio). If empty, start an AVD now or plug in your phone with USB debugging enabled.

- [ ] **Step 1.3: No commit** — this task is verification only.

---

## Task 2 — Add `tauri-plugin-os` (Rust + frontend)

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `package.json`

- [ ] **Step 2.1: Add Rust dep**

In `src-tauri/Cargo.toml`, append to `[dependencies]`:

```toml
tauri-plugin-os = "2"
```

- [ ] **Step 2.2: Register the plugin in lib.rs**

In `src-tauri/src/lib.rs`, the `tauri::Builder::default()` chain currently calls `.plugin(tauri_plugin_opener::init())`. Add `.plugin(tauri_plugin_os::init())` on a new chained line below it.

- [ ] **Step 2.3: Add JS dep**

In `package.json`, add to `dependencies`:

```json
"@tauri-apps/plugin-os": "^2"
```

- [ ] **Step 2.4: Install + verify**

```
npm install
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npx tsc --noEmit
npm test
```

Expected: install clean, cargo clean, 44 tests still pass, tsc clean, 20 vitest still pass.

- [ ] **Step 2.5: Commit**

```
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs package.json package-lock.json
git commit -m "Add tauri-plugin-os for platform detection on mobile"
```

---

## Task 3 — `tauri android init`

This generates the Android Gradle project. It must run after Rust deps are in place (Task 2) and before any Android build attempt.

**Files:**
- Created by Tauri: `src-tauri/gen/android/` (entire directory tree — checked in)

- [ ] **Step 3.1: Run the init**

From the project root:

```
npm run tauri android init
```

Expected output (last few lines): something about "Generated Android Studio project at … gen/android". The command modifies `src-tauri/tauri.conf.json` minimally if needed and writes a full Gradle project under `src-tauri/gen/android/`.

If init fails (e.g. JDK version error, NDK not found), **STOP and report BLOCKED with the exact error**. Don't try to hand-edit gen files.

- [ ] **Step 3.2: Inspect what was generated**

Skim `src-tauri/gen/android/app/build.gradle.kts` and `src-tauri/gen/android/app/src/main/AndroidManifest.xml`. Make sure no secrets or absolute Windows paths leaked in. (If absolute paths to your home dir appear, that's a Tauri 2 bug — flag and investigate, don't commit.)

- [ ] **Step 3.3: Verify the desktop build still works**

```
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: clean check, 44 tests pass. (`tauri android init` should not break desktop.)

- [ ] **Step 3.4: Commit the generated tree**

```
git add src-tauri/gen/ src-tauri/tauri.conf.json
git commit -m "tauri android init: generate gen/android Gradle project"
```

Note: this commit is large (a few thousand lines of Gradle/Kotlin scaffolding). That's expected. The whole `gen/android/` tree is intentionally checked in per Phase 1 conventions in CLAUDE.md.

---

## Task 4 — `lib/viewport.ts`: `useMediaQuery` + `useIsMobile`

**Files:**
- Create: `src/lib/viewport.ts`

- [ ] **Step 4.1: Write the file**

Create `src/lib/viewport.ts`:

```ts
import { useEffect, useState } from "react";

/** Reactive media-query hook. Returns true when the query matches. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener("change", handler);
    setMatches(mq.matches);
    return () => mq.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

/** Convenience: true if the viewport is narrow (phone / small window). */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 720px)");
}
```

- [ ] **Step 4.2: Verify**

`npx tsc --noEmit` — 0 errors. (No vitest cases needed — this is too tied to `window.matchMedia` to test cheaply.)

- [ ] **Step 4.3: Commit**

```
git add src/lib/viewport.ts
git commit -m "Add useMediaQuery + useIsMobile hooks"
```

---

## Task 5 — `BottomTabs` component

**Files:**
- Create: `src/shell/BottomTabs.tsx`

- [ ] **Step 5.1: Write the component**

Create `src/shell/BottomTabs.tsx`:

```tsx
import { NavLink } from "react-router-dom";
import { Indexes } from "../state/indexes";
import { todayIso } from "../lib/dates";

type Props = { indexes: Indexes };

const TABS = [
  { to: "/today",    label: "Today",    icon: "●" },
  { to: "/inbox",    label: "Inbox",    icon: "▣" },
  { to: "/upcoming", label: "Upcoming", icon: "◔" },
  { to: "/search",   label: "Search",   icon: "⌕" },
] as const;

export function BottomTabs({ indexes }: Props) {
  const todayCount = indexes.today(todayIso()).length;
  const inboxCount = indexes.inbox.length;

  return (
    <nav className="bottom-tabs" role="navigation" aria-label="Primary">
      {TABS.map(t => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) => isActive ? "bottom-tab active" : "bottom-tab"}
        >
          <span className="bottom-tab-icon" aria-hidden>{t.icon}</span>
          <span className="bottom-tab-label">{t.label}</span>
          {t.to === "/today" && todayCount > 0 && <span className="bottom-tab-badge">{todayCount}</span>}
          {t.to === "/inbox" && inboxCount > 0 && <span className="bottom-tab-badge">{inboxCount}</span>}
        </NavLink>
      ))}
    </nav>
  );
}
```

- [ ] **Step 5.2: Verify**

`npx tsc --noEmit` — 0 errors.

- [ ] **Step 5.3: Commit**

```
git add src/shell/BottomTabs.tsx
git commit -m "Add BottomTabs: Today/Inbox/Upcoming/Search with count badges"
```

---

## Task 6 — `MobileHeader` component

**Files:**
- Create: `src/shell/MobileHeader.tsx`

- [ ] **Step 6.1: Write the component**

Create `src/shell/MobileHeader.tsx`:

```tsx
import { Link, useLocation } from "react-router-dom";
import { Document } from "../lib/tauri";
import { Indexes } from "../state/indexes";

type Props = { doc: Document; indexes: Indexes };

const ROUTE_TITLES: Record<string, string> = {
  "/today":    "Today",
  "/inbox":    "Inbox",
  "/upcoming": "Upcoming",
  "/search":   "Search",
  "/settings": "Settings",
};

export function MobileHeader({ doc, indexes }: Props) {
  const loc = useLocation();
  const title = pickTitle(loc.pathname, doc, indexes);

  return (
    <header className="mobile-header">
      <h1 className="mobile-title">{title}</h1>
      <Link to="/settings" className="mobile-header-icon" aria-label="Settings">
        ⚙
      </Link>
    </header>
  );
}

function pickTitle(pathname: string, doc: Document, indexes: Indexes): string {
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname];
  const projMatch = pathname.match(/^\/project\/(.+)$/);
  if (projMatch) return indexes.projectsById.get(projMatch[1])?.name ?? "Project";
  const tagMatch = pathname.match(/^\/tag\/(.+)$/);
  if (tagMatch) {
    const tag = indexes.tagsById.get(tagMatch[1]);
    return tag ? `#${tag.name}` : "Tag";
  }
  if (pathname.startsWith("/conflicts/")) return "Conflict";
  return "Pansutong";
}
```

- [ ] **Step 6.2: Verify**

`npx tsc --noEmit` — 0 errors.

- [ ] **Step 6.3: Commit**

```
git add src/shell/MobileHeader.tsx
git commit -m "Add MobileHeader: title from route + gear to /settings"
```

---

## Task 7 — `MobileShell` + styles + viewport meta

**Files:**
- Create: `src/shell/MobileShell.tsx`
- Modify: `src/styles/global.css`
- Modify: `index.html`

- [ ] **Step 7.1: Write `MobileShell.tsx`**

Create `src/shell/MobileShell.tsx`:

```tsx
import { ReactNode } from "react";
import { Document } from "../lib/tauri";
import { Indexes } from "../state/indexes";
import { MobileHeader } from "./MobileHeader";
import { BottomTabs } from "./BottomTabs";

type Props = { doc: Document; indexes: Indexes; children: ReactNode };

export function MobileShell({ doc, indexes, children }: Props) {
  return (
    <div className="mobile-shell">
      <MobileHeader doc={doc} indexes={indexes} />
      <main className="mobile-main">{children}</main>
      <BottomTabs indexes={indexes} />
    </div>
  );
}
```

- [ ] **Step 7.2: Append mobile styles to `src/styles/global.css`**

```css
.mobile-shell {
  display: grid;
  grid-template-rows: auto 1fr auto;
  height: 100%;
}
.mobile-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: max(var(--space-3), env(safe-area-inset-top)) var(--space-4) var(--space-2);
  background: var(--c-surface);
  border-bottom: 1px solid var(--c-border);
}
.mobile-title {
  font-size: 1.2rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin: 0;
}
.mobile-header-icon {
  font-size: 1.4rem;
  color: var(--c-text-muted);
  padding: var(--space-2);
  text-decoration: none;
}
.mobile-main {
  padding: var(--space-3) var(--space-4) var(--space-3);
  overflow-y: auto;
  background: var(--c-bg);
}
.bottom-tabs {
  display: flex;
  justify-content: space-around;
  padding: var(--space-1) 0 max(var(--space-1), env(safe-area-inset-bottom));
  background: var(--c-surface);
  border-top: 1px solid var(--c-border);
}
.bottom-tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: var(--space-2) var(--space-1);
  color: var(--c-text-muted);
  font-size: 0.65rem;
  text-decoration: none;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  position: relative;
}
.bottom-tab.active { color: var(--c-accent); font-weight: 600; }
.bottom-tab-icon  { font-size: 1.1rem; line-height: 1; }
.bottom-tab-badge {
  position: absolute;
  top: 4px;
  right: 25%;
  background: var(--c-danger);
  color: white;
  border-radius: 999px;
  padding: 1px 5px;
  font-size: 0.6rem;
  font-weight: 700;
  min-width: 14px;
  text-align: center;
}

/* Touch-friendly tap targets at narrow widths. */
@media (max-width: 720px) {
  .task-row {
    padding: var(--space-3);
    gap: var(--space-3);
    font-size: 1rem;
  }
  .task-row input[type="checkbox"] {
    width: 22px;
    height: 22px;
  }
  .task-delete {
    padding: var(--space-1) var(--space-2);
    font-size: 1.5rem;
  }
  .composer input,
  .search-input {
    font-size: 16px;  /* prevents iOS/Android auto-zoom */
  }
}
```

- [ ] **Step 7.3: Update `index.html` viewport meta**

Open `index.html`. Find:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
```

Replace with:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

`viewport-fit=cover` is what makes `env(safe-area-inset-*)` populate with real notch/gesture-bar insets on Android.

- [ ] **Step 7.4: Verify**

`npx tsc --noEmit` — 0 errors. (No tests change.)

- [ ] **Step 7.5: Commit**

```
git add src/shell/MobileShell.tsx src/styles/global.css index.html
git commit -m "Add MobileShell with bottom tabs + safe-area + touch-friendly rows"
```

---

## Task 8 — Wire shell selection in `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 8.1: Add imports + use the hook**

In `src/App.tsx`:

```tsx
import { MobileShell } from "./shell/MobileShell";
import { useIsMobile } from "./lib/viewport";
```

Inside the `App` component, after `useDocument()`:

```tsx
  const isMobile = useIsMobile();
  const Shell    = isMobile ? MobileShell : DesktopShell;
```

Change the JSX that wraps `<Routes>`. Currently it's `<DesktopShell doc={doc} indexes={indexes}>`. Replace with `<Shell doc={doc} indexes={indexes}>`.

The complete render section becomes:

```tsx
  return (
    <BrowserRouter>
      <Shell doc={doc} indexes={indexes}>
        <Routes>
          <Route path="/"          element={<Navigate to="/today" replace />} />
          <Route path="/today"     element={<TodayView doc={doc} indexes={indexes} />} />
          <Route path="/inbox"     element={<InboxView doc={doc} indexes={indexes} />} />
          <Route path="/upcoming"  element={<UpcomingView indexes={indexes} />} />
          <Route path="/project/:id" element={<ProjectView indexes={indexes} />} />
          <Route path="/tag/:id"     element={<TagView indexes={indexes} />} />
          <Route path="/search"      element={<SearchView indexes={indexes} />} />
          <Route path="/settings"    element={<SettingsView doc={doc} indexes={indexes} />} />
          <Route path="/conflicts/:filename" element={<ConflictsView />} />
          <Route path="*"            element={<p>Not built yet.</p>} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
```

- [ ] **Step 8.2: Verify**

- `npx tsc --noEmit` — 0 errors.
- `npm run build` — Vite produces a clean dist.
- Resize the desktop dev window down to <720px wide once you launch `npm run tauri dev`: the bottom tabs should appear and the sidebar should vanish.

- [ ] **Step 8.3: Commit**

```
git add src/App.tsx
git commit -m "Select MobileShell vs DesktopShell based on viewport"
```

---

## Task 9 — Verify the Android Rust build

**Files:** none

- [ ] **Step 9.1: cargo check for the primary Android target**

From the project root:

```
cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-linux-android
```

Expected: clean. (First run may compile a few hundred crates for the Android target — several minutes.)

If it fails on the `notify` crate or any platform-specific code, **STOP and report BLOCKED** with the exact error. Likely root causes if it fails:
- NDK path wrong → check `$env:NDK_HOME` points at a versioned subdir.
- A direct/indirect dep doesn't support Android → unlikely with this dep set but possible.

- [ ] **Step 9.2: No commit** — verification only.

---

## Task 10 — Smoke test on emulator / device

**Files:** none

- [ ] **Step 10.1: Launch in dev mode**

```
npm run tauri android dev
```

Expected: Gradle compiles the APK (slow first time — 10+ minutes), installs it on the connected device/emulator, and the app launches with the mobile shell active.

- [ ] **Step 10.2: Verify the basics**

On the device/emulator:
1. Today view loads with the bottom tabs.
2. Tap the composer, type `Buy milk`, hit Add. The task appears.
3. Tap the checkbox — strike-through.
4. Tap the Inbox tab — switches view.
5. Tap the gear in the header — Settings opens.
6. Theme switcher works.
7. Kill the app, relaunch — tasks persist (in `/data/data/net.puetsua.pansutong/files/tasks.json` or equivalent).

- [ ] **Step 10.3: Verify safe-area on a phone with a notch**

If your device has a notch or gesture bar, the bottom tab bar should NOT be obscured and the header should clear the status bar. If either area gets clipped, double-check `viewport-fit=cover` is in `index.html` and the mobile-header / bottom-tabs styles use `env(safe-area-inset-*)`.

- [ ] **Step 10.4: Resize behavior on tablet / foldable**

If you have a wide-screen Android device (>720px in portrait, e.g. a foldable opened), the DesktopShell with sidebar should appear instead. This isn't strictly required for v1 but it's a nice byproduct of the viewport-based selector.

- [ ] **Step 10.5: If everything works, no further commit needed.**

---

## Phase 4 done

You now have:
- A working Android APK that runs the existing Pansutong task tracker with a bottom-tab mobile shell.
- App-private storage at `app_data_dir()/tasks.json` on Android — works offline, no permission prompts.
- The same `useDocument` plumbing, `store-changed` events, smart-parse composer, all views, settings, and theme switcher as on desktop.
- A responsive shell selector that swaps to the desktop sidebar layout when the viewport is wide enough (foldables, tablets, debug-window-resize).

## Known limitations after Phase 4

- **No cross-device sync from Android.** The phone runs locally; to ferry tasks you'd manually export/import or run desktop-only sync via Syncthing. The next plan (`phase-4b-saf-sync.md`) will add a SAF folder picker so the app can read/write through a Syncthing-managed folder.
- **No quick-capture share intent.** Adding a task on Android currently requires opening the app. The Phase 3 plan (`pansutong-phase-3-quick-capture.md`) covers the share-target intent + home-screen widget; that work can land in either order with this plan.
- **No background sync on Android.** Even after 4B, Pansutong won't sync while the app is closed — Syncthing-for-Android handles transport, but Pansutong reads on next foreground.

## What's next

Two independent plans to pick up after this one:

- `pansutong-phase-3-quick-capture.md` — global Ctrl+Shift+N on desktop + share intent on Android. Smallest of the remaining slices.
- `pansutong-phase-4b-saf-sync.md` (not yet written) — SAF folder picker, polling fallback, full cross-device sync from Android.
