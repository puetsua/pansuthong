# PR #249 QA round-3 fix verification (Linux)

- After: code `a07e01b`, AppImage `0.33.0-pr249g` built on the box, sha256 `19b49d7a…7655`.
- Before: the pre-fix build at `56946bc` (`0.33.0-pr249f`, sha256 `f9acff38…a807`), run on the same machine with the same steps.
- Rig: 8 CPUs, 15 GiB RAM, no swap. Own Xvfb `:52`, window 1400×950, Settings scrolled to the MCP section. Port 7381; 7373 was never used.
- Data: fresh isolated HOME per run, each seeded from the same fixture copy, written only through MCP:
  - 656 tasks;
  - 5,000 tasks;
  - 656 tasks plus 4 notes of 4,000,000 bytes each (≈16 MiB).
- Timing method: QA's r3 scripts (`burst.py`, `uilag.py`, `memgrow.py`), unchanged except for paths, port and token. Each latency is the time from an xdotool click on Completion sound On/Off until the button paints as selected. Timeouts are 60 s.
- Memory: RSS of the backend (`pansuthong`) and `WebKitWebProcess`.
- Memory cap: load loops stop at 4 GiB of app-tree RSS (3.5 GiB for the 16 MiB run). A watchdog kills the app at 6 GiB. There was no kernel OOM kill.
- All times are Asia/Taipei, 2026-10-28 03:12–03:42.

## N5: UI under concurrent MCP writers, and memory

Settings click repaint latency. A burst is 10 s with the click at t = 1 s. A sustained run is 30 s with a click every ≈1 s.

| Document | Writers | Before 56946bc | After a07e01b |
|---|---|---|---|
| 656 tasks | idle | median 0.16 s | median 0.12 s |
| 656 tasks | 1 (burst) | 0.30 s | 0.12 s |
| 656 tasks | 2 (burst) | 0.56 s | 0.45 s |
| 656 tasks | 4 (burst) | **10.46 s** (painted 1.46 s after the burst ended) | 0.13 s |
| 656 tasks | 2 (sustained) | **20.4 s and 46.9 s** (n = 2 in 70 s) | median 0.12, max 0.12 s (n = 26) |
| 656 tasks | 4 (sustained) | **> 60 s** (not painted) | median 0.12, max 0.19 s (n = 26) |
| 5,000 tasks | 1 (burst) | 0.31 s | 0.12 s |
| 5,000 tasks | 2 (burst) | **9.81 s** | 0.12 s |
| 5,000 tasks | 4 (burst) | **10.38 s** | 0.12 s |
| 5,000 tasks | 2 (sustained) | **> 60 s** | median 0.12, max 0.14 s (n = 26) |
| 5,000 tasks | 4 (sustained) | **> 60 s** | median 0.12, max 0.12 s (n = 26) |
| ≈16 MiB | 2 (10 s) | **> 60 s**; the cap was reached and the app was killed by the watchdog | median 0.21, max 0.27 s (n = 8) |
| ≈16 MiB | 4 (10 s) | not run (app already killed) | median 0.20, max 0.30 s (n = 8) |

Throughput with 4 writers at 5,000 tasks: 17.9 creates/s before, 68.4 creates/s after.

Memory (MiB, backend + WebKitWebProcess):

| Document | Before: after bursts | Before: peak | After: after bursts | After: peak |
|---|---|---|---|---|
| idle at start | 211 + 391 | — | 213 + 392 | — |
| 656 tasks | 1,303 + 2,631 (after sustained 2 and 4 writers) | 1,998 + 2,921; tree 4.19 GiB, loops stopped at the cap | 267 + 446 (after sustained runs); 270 + 441 at 30 s after a 4×30 s run | 284 + 475; tree 0.80 GiB |
| 5,000 tasks | 289 + 4,801 | WebKit 4,802; tree 5.03 GiB, loops stopped at the cap | 267 + 436; 288 + 436 at 30 s after a 4×30 s run | 314 + 475; tree 0.83 GiB |
| ≈16 MiB | 2,707 + 828 at the 3.5 GiB cap. It kept growing after the loops stopped and reached 6.06 GiB, so the watchdog killed it | 6.06 GiB tree | 379 + 462 after 2- and 4-writer runs; 419 + 463 at 30 s after a 4×20 s run | 498 + 716; tree 1.19 GiB |

The after build handled 2–5× more writes in the same scenarios: the 656-task run ended at 13,146 tasks and the 5,000-task run at 14,673. Memory still returned to within ≈0.1 GiB of the idle baseline.

Screenshots:
- `r3-n5-pair.png`. Top: before, 3.0 s after clicking Off with 4 writers running; On is still shown. Bottom: after, 0.3 s after the click with 4 writers running; Off is shown.
- Full frames: `r3-n5-before56946bc-4writers-click-full.png`, `r3-n5-after7-4writers-click-full.png`.

## Low items

| Item | Before 56946bc | After a07e01b |
|---|---|---|
| a. Rejected port | The field reverts to 7381 and the message stays (stale) | The field keeps `1e4` with "Port must be an integer from 1024 to 65535."; config stays 7381; still the same after an MCP Off/On. Typing 7381 again clears the message |
| b. `"default": null` | Present on list_tasks.limit, list_tasks.offset, update_task.title | None in any tool schema; types and bounds unchanged |
| c. Malformed, trailing-garbage, or empty JSON | 415 / -32700 | 400 / -32700, `id:null`; `application/jsonx` stays 415 / -32600 |
| d. Notification with bad params (3 variants) | 400 with a JSON error body | 202, Content-Length 0 |
| e. Ill-typed or missing arguments (11 cases over raw HTTP: get_task `{}` / id 5 / id null / arguments omitted, create_task `{}` / title 5, update_task `{}` / estimated_minutes "a", complete_task id [], delete_task `{}`, list_tasks view 5) | HTTP 200 `result.isError:true` | HTTP 200, JSON-RPC error -32602 with the request id (101–111). SDK 1.32.2 (strict) throws `McpError` -32602 in each case, with 0 `onerror` events. Nothing was created |
| f. Keep-Alive | Absent | `Keep-Alive: timeout=10` on 200, 202, 400, 401, 403, 415 |

Screenshots:
- `r3-a-pair.png`. Top: before, a stale message under 7381. Bottom: after, `1e4` kept with its message.
- `r3-a-after7-1e4-after-restart-full.png`
- `r3-a-after7-restored-crop.png`

## Regression

- `endpoint-test.py` on a fresh after-build profile: 25 PASS, 0 FAIL.
- Security matrix: 36 cases, 0 unexpected.
- Focused `cargo test --lib`: 9 passed. These cover read_does_not_wait_for_in_progress_write, both delta_persist tests, burst_of_changes_is_coalesced_with_trailing_event, argument_deserialization_failures_become_invalid_params, advertised_tool_schemas_have_no_null_defaults, the hash test, committed_writes_get_their_response_across_restarts, and stop_with_slowloris_client_does_not_block_and_is_bounded.

The token field is masked in every screenshot, and no token appears in any file.
