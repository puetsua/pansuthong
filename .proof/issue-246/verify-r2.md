# PR #249 QA round-2 fix verification (Linux)

- Code: `56946bc`. AppImage built on the box: `Pansuthong_0.33.0-pr249f_amd64.AppImage`, sha256 `f9acff38…a807`.
- Run: Xvfb `:2`, isolated HOME (`home-after6`, fresh data folder), MCP on, port 7373. All times Asia/Taipei, 2026-10-27 23:35–23:46.
- Scripts: QA's r2 scripts (`/workspace/qa-249r2`), copied and pointed at port 7373 and the isolated profile, plus `endpoint-test.py`.

| Item | Result | Key numbers |
|---|---|---|
| N1 stop with slowloris client | PASS | Partial-header client connected, then Enable → Off: button repainted after 0.129 s, listener gone after 0.130 s, an unrelated Settings click repainted after 0.131 s, and the slow socket was closed by the server 2.513 s after the click. Off then On 0.64 s later: each repaint took 0.12–0.13 s, the listener was back 0.130 s after On, and the slow socket closed at 2.513 s. Without a settings change, the header-read timeout closes the slow socket at 10.001 s. A partial body gets 408 / -32600 at 30.0 s |
| B2 writes during Enable Off/On | PASS | 3 runs, 4 create loops each (retrying the same title on failure), with 5, 5, and 8 Off/On cycles. Committed rows = 200 OK responses in every run: 790/790, 559/559, 388/388. 0 HTTP 500, 0 duplicate titles. The only failures were ConnectionRefused while Off (56/32/41), and titles that never got an OK have no row. An unrelated setting toggle keeps the same listener inode, and a keep-alive socket survives it |
| N2 gate errors echo the id | PASS | tools/call without params id 9 → HTTP 200 `"id":9` -32602. list_tasks limit 0 id 18 → HTTP 200 `"id":18` -32602. SDK 1.32.2 now reports `MCP error -32602` per call, with no transport error and no `onerror` |
| N3 list_tasks schema/validation | PASS | Schema: `limit` integer, minimum 1, maximum 500; `offset` integer, minimum 0. limit 0, -1, "5", 1.5, null, true, 501, 2000, 4294967295, 4294967296, and 1e20 → -32602 (HTTP 200). offset -1, "5", 1.5, null, and 4294967296 → -32602. On 654 tasks: default 500 with truncated:true; offset 500 → 154; 7 pages of 100 give 654 unique ids |
| N4 "Port in use" under Port field | PASS | With 7373 held by another process, Enable On shows "Port in use — choose another port. Address already in use (os error 98)" under the Port field, and it is not repeated in the bottom status line. Enable button top is at y=745 in both the listening and port-in-use screenshots |
| Write hash computed once | PASS | `store.rs` `write()` hashes only the new document (`g.own_hash = content_hash(&g.doc)`; a no-op is detected by structural equality). `cached_hash_tracks_document_and_write_hashes_once` passes on the box |
| Nit: port `1e4` | PASS | Rejected with "Port must be an integer from 1024 to 65535."; config stays 7373 |
| Nit: `application/jsonx` | PASS | 415, -32600 |
| Nit: batch / `jsonrpc:"1.0"` | PASS | Batch → 400 `id:null` -32600. `jsonrpc:"1.0"` → 200 `id:17` -32600. Malformed JSON stays -32700 |
| Nit: `title:null` / `tags:null` | PASS | `title:null` → -32602 "title cannot be null". `tags:null` → tags `[]` |

Regression: `endpoint-test.py` 27/27 PASS. Security matrix 36 cases, 0 unexpected. 50 and 3×200 concurrent creates: all 200, exact row counts. B1, B3, B9, and B10 behave as in round 2. Focused `cargo test --lib` (13 tests: slowloris stop, header/body timeouts, committed writes across restarts, gate ids, list_tasks bounds, media type, batch/version, title/tags null, hash once) passed.

Observations (not in the r2 list; not blocking):
1. Settings › MCP Port field: after typing an invalid value (for example `1e4`) and leaving the field, the input reverts to 7373 but the validation message stays. It also stays after MCP restarts and listens, and clears only after the next valid edit. Screenshot: `r2-nit-port-1e4-blur-crop.png`.
2. While 4 MCP clients create tasks continuously (about 47 creates/s on about 2,400 tasks), Settings clicks take 3–5 s to repaint even with no MCP toggle. They take 0.12 s when idle. This comes from write load, not from MCP stop. One toggle click in B2 run 1 landed during such a lag, so that run ended Off. UI, config, and listener stayed consistent.
3. The list_tasks schema still carries `"default": null` on the non-nullable `limit`/`offset`.

Screenshots: `r2-n4-port-in-use-pair.png` (top: listening; bottom: port in use), `r2-n4-port-in-use-crop.png`, `r2-n4-port-in-use-full.png`, `r2-n1-off-with-slowloris-crop.png` (Off shown 0.5 s after the click while the slow client is still connected), `r2-nit-port-1e4-typed-crop.png`, `r2-nit-port-1e4-blur-crop.png`. No token is visible; the Token field stays masked.
