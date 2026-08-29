# <img src="src-tauri/icons/128x128.png" alt="" width="48" height="48" /> Pansuthong

[![CI](https://github.com/puetsua/pansuthong/workflows/CI/badge.svg)](https://github.com/puetsua/pansuthong/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/puetsua/pansuthong)](https://github.com/puetsua/pansuthong/releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20Android-lightgrey)](https://github.com/puetsua/pansuthong/releases/latest)
[![License: FSL-1.1-MIT](https://img.shields.io/badge/license-FSL--1.1--MIT-blue)](./LICENSE)

**繁體中文:** [README.md](./README.md)

A personal task tracker for **Windows**, **Linux**, and **Android**. Organize work with **tasks** and **tags**—no project hierarchy to maintain—so you can see what to do today, what’s in the inbox, and how a tag is going over time.

Built for people who want a focused daily list plus light life-tracking (time spent, streaks, heatmaps), with the same app on desktop and phone.

## What it does well

- **Tasks + tags** — Tag tasks, pin important tags, and use tag weight to influence priority. Views are live queries, not another list you sync by hand.
- **Day-to-day views** — Today, Inbox (untagged), Upcoming, Search, and Archived when you need them.
- **Templates & recurring** — Reusable task templates and a recurring-work dashboard.
- **Time & history** — Track time spent on tasks, allocate idle time, and browse completion history.
- **Tag analytics** — Heatmaps, streaks, and time spent per tag.
- **Cross-device sync** — Point both sides at the same shared folder (e.g. a cloud sync directory) to merge tasks, tags, and attachments.
- **Local-first** — Data lives on disk; settings stay on the device. Desktop can update in-app from GitHub Releases.

UI languages: English, Traditional Chinese.

## Install

Download the latest build from [Releases](https://github.com/puetsua/pansuthong/releases/latest).

| Platform | File | Notes |
| --- | --- | --- |
| **Windows** | `Pansuthong_<version>_x64-setup.exe` | Per-user installer; no admin required. |
| **Linux** | `Pansuthong_<version>_amd64.AppImage` | Portable. `chmod +x` after download, then run. Some distros need FUSE. |
| **Linux (Debian/Ubuntu)** | `Pansuthong_<version>_amd64.deb` | Requires WebKitGTK 4.1. |
| **Android** | `Pansuthong_<version>_universal.apk` | Sideload (allow unknown sources). Signed for install/update; not on Play Store yet. |

In-app updates on Linux fetch the AppImage (`*.AppImage.tar.gz`), not the `.deb`.

## Develop

```bash
npm install
npm run tauri dev          # desktop (Windows / Linux, Pansuthong Dev)
npm run tauri android dev  # Android emulator or USB device
```

Stack: Tauri 2 (Rust) · React 19 · TypeScript · Vite.

Contributor and agent docs live under [`docs/`](./docs/)—start with [`AGENTS.md`](./AGENTS.md) and [`docs/llm-navigation.md`](./docs/llm-navigation.md). Toolchain notes: [`docs/agent/commands-toolchain.md`](./docs/agent/commands-toolchain.md).

## License

[Functional Source License, Version 1.1, MIT Future License (FSL-1.1-MIT)](./LICENSE).

In plain terms:

- **Personal use** — free.
- **Internal company use** — allowed at any company size.
- **Fork and share** — allowed; keep the license and copyright notices.
- **Don’t sell it as a product** — you may not offer Pansuthong, or software that is substantially similar and built on it, as a commercial product or service.
- **MIT after two years** — each release flips to a standard [MIT](https://opensource.org/license/mit) license on its second anniversary.

Full text: [LICENSE](./LICENSE). Background: [fsl.software](https://fsl.software).
