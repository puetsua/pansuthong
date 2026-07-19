# Pansuthong

[![CI](https://github.com/puetsua/pansuthong/workflows/CI/badge.svg)](https://github.com/puetsua/pansuthong/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/puetsua/pansuthong)](https://github.com/puetsua/pansuthong/releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Android-lightgrey)](https://github.com/puetsua/pansuthong/releases/latest)
[![License: FSL-1.1-MIT](https://img.shields.io/badge/license-FSL--1.1--MIT-blue)](./LICENSE)

**English:** [README.en.md](./README.en.md)

個人用任務追蹤器，支援 **Windows** 與 **Android**。用**任務**與**標籤**整理工作——不必維護專案階層——一眼看到今天該做什麼、收件匣還有什麼，以及某個標籤長期下來的狀況。

適合想要「專注的每日清單」加上輕量生活追蹤（花費時間、連續天數、熱圖）的人；桌面與手機是同一套應用。

## 擅長什麼

- **任務 + 標籤** — 為任務加上標籤、釘選重要標籤，並用標籤權重影響優先順序。檢視是即時查詢，不是另一套要手動同步的清單。
- **日常檢視** — 今日、收件匣（未標籤）、即將到來、搜尋、已封存，需要時才出現。
- **範本與週期** — 可重用的任務範本，以及週期工作儀表板。
- **時間與歷程** — 追蹤任務花費時間、分配閒置時間，並瀏覽完成紀錄。
- **標籤分析** — 各標籤的熱圖、連續天數與花費時間統計。
- **跨裝置同步** — 兩邊都指向同一個共用資料夾（例如雲端同步目錄），即可合併任務、標籤與附件。
- **本機優先** — 資料存在磁碟上；設定留在本機裝置。桌面版可從 GitHub Releases 應用內更新。

介面語言：英文、繁體中文。

## 安裝

請至 [Releases](https://github.com/puetsua/pansuthong/releases/latest) 下載最新版本。

| 平台 | 檔案 | 說明 |
| --- | --- | --- |
| **Windows** | `Pansuthong_<version>_x64-setup.exe` | 每位使用者安裝程式；不需系統管理員權限。 |
| **Android** | `Pansuthong_<version>_universal.apk` | 側載安裝（需允許未知來源）。已簽署，可正常安裝／更新；尚未上架 Play 商店。 |

## 開發

```bash
npm install
npm run tauri dev          # Windows 桌面（Pansuthong Dev）
npm run tauri android dev  # Android 模擬器或 USB 裝置
```

技術棧：Tauri 2（Rust）· React 19 · TypeScript · Vite。

貢獻者與代理（agent）文件在 [`docs/`](./docs/)——可從 [`AGENTS.md`](./AGENTS.md) 與 [`docs/llm-navigation.md`](./docs/llm-navigation.md) 開始。工具鏈說明：[`docs/agent/commands-toolchain.md`](./docs/agent/commands-toolchain.md)。

## 授權

[Functional Source License, Version 1.1, MIT Future License（FSL-1.1-MIT）](./LICENSE)。

白話說明：

- **個人使用** — 免費。
- **公司內部使用** — 不論公司規模皆可。
- **分支與分享** — 允許；請保留授權與著作權聲明。
- **勿當成產品販售** — 不得將 Pansuthong，或依其打造且實質相似的軟體，以商業產品或服務形式提供。
- **兩年後轉為 MIT** — 每個發行版在滿兩週年時改為一般 [MIT](https://opensource.org/license/mit) 授權。

完整條文：[LICENSE](./LICENSE)。背景說明：[fsl.software](https://fsl.software)。
