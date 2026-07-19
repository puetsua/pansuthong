# <img src="src-tauri/icons/128x128.png" alt="" width="48" height="48" /> Pansuthong

[![CI](https://github.com/puetsua/pansuthong/workflows/CI/badge.svg)](https://github.com/puetsua/pansuthong/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/puetsua/pansuthong)](https://github.com/puetsua/pansuthong/releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Android-lightgrey)](https://github.com/puetsua/pansuthong/releases/latest)
[![License: FSL-1.1-MIT](https://img.shields.io/badge/license-FSL--1.1--MIT-blue)](./LICENSE)

**English:** [README.en.md](./README.en.md)

個人用任務追蹤器，跑在 **Windows** 與 **Android**。用**任務**和**標籤**整理事情就好，不用另外建專案階層。今天該做什麼、未分類還剩什麼、某個標籤長期狀況如何，一眼就能看清楚。

適合想要「專心處理今天這份清單」，又想順便記一點花費時間、連續天數、熱圖的人。電腦跟手機用的是同一個 App。

## 特色

- **任務 + 標籤** — 幫任務貼標籤、釘選常用標籤，也能用標籤權重影響優先順序。畫面上的清單是即時查出來的，不是另一套還要自己同步的東西。
- **日常畫面** — 今日、未分類（沒有釘選標籤的）、即將到來、搜尋、已封存，用得到才會出現。
- **範本與週期** — 可重複使用的任務範本，以及週期工作總覽。
- **時間與歷程** — 記錄任務花了多少時間、把閒置時間分給任務，也能翻完成紀錄。
- **標籤分析** — 每個標籤的熱圖、連續天數、花費時間。
- **跨裝置同步** — 兩邊都指向同一個共用資料夾（例如雲端同步資料夾），就能合併任務、標籤與附件。
- **本機優先** — 資料存在本機；設定跟著裝置走，不會跟著同步。桌面版可從 GitHub Releases 在 App 內更新。

介面語言：英文、繁體中文。

## 安裝

到 [Releases](https://github.com/puetsua/pansuthong/releases/latest) 下載最新版。

| 平台 | 檔案 | 說明 |
| --- | --- | --- |
| **Windows** | `Pansuthong_<version>_x64-setup.exe` | 每位使用者安裝；不需要系統管理員權限。 |
| **Android** | `Pansuthong_<version>_universal.apk` | 自行安裝（需允許未知來源）。已簽署，可正常安裝／更新；尚未上架 Play 商店。 |

## 開發

```bash
npm install
npm run tauri dev          # Windows 桌面（Pansuthong Dev）
npm run tauri android dev  # Android 模擬器或 USB 裝置
```

技術棧：Tauri 2（Rust）· React 19 · TypeScript · Vite。

貢獻與 agent 文件在 [`docs/`](./docs/)——可從 [`AGENTS.md`](./AGENTS.md) 與 [`docs/llm-navigation.md`](./docs/llm-navigation.md) 開始。工具鏈說明：[`docs/agent/commands-toolchain.md`](./docs/agent/commands-toolchain.md)。

## 授權

[Functional Source License, Version 1.1, MIT Future License（FSL-1.1-MIT）](./LICENSE)。

白話說明：

- **個人使用** — 免費。
- **公司內部使用** — 不論公司大小都可以。
- **分支與分享** — 可以；請保留授權與著作權聲明。
- **不要當產品賣** — 不得把 Pansuthong，或依它做出來、實質很像的軟體，當成商業產品或服務來賣。
- **兩年後變 MIT** — 每個發行版滿兩週年後，改為一般 [MIT](https://opensource.org/license/mit) 授權。

完整條文：[LICENSE](./LICENSE)。背景說明：[fsl.software](https://fsl.software)。
