# Keystone desktop performance

Status: a first cold-start and idle-memory baseline was measured on 2026-11-04 (below). **The `window_ms` and `ready_ms` figures have not been checked against a stopwatch**, so treat them as indicative; the memory figures are straightforward process counters.

## Method

`desktop/scripts/measure-perf.ps1` (Windows, PowerShell) starts a built binary `-Runs` times, each time killing the previous process tree, and records:

- `window_ms`: start until the process owns a top-level window.
- `ready_ms`: start until at least `-MinProcesses` processes exist (app plus its `msedgewebview2` helpers) and the whole tree has been CPU-quiet (`-QuietCpuPercent`, default 3%) for `-QuietMs`.
- idle working set and private bytes, summed over the process tree, `-IdleSeconds` after ready.

Runs are cold process starts, not cold disk caches. The app starts in whatever profile state the machine has. Working set double-counts pages shared between WebView2 processes; private bytes is the better figure. A Linux or macOS script is not provided: the ready signal there would need window-system tooling that was not available to test.

```
cd desktop
npm run tauri -- build --no-bundle
powershell -NoProfile -File scripts/measure-perf.ps1 -Exe target/release/keystone-desktop.exe -Runs 10 -Json perf-release.json
```

Known caveat: a trial of an earlier revision of the script (before `-MinProcesses`) reported implausibly early ready times, because the CPU looked quiet before the webview helpers had started. The revision in this repository adds that gate; the run below used it and every run saw 7 processes, but `ready_ms` has still not been compared with a stopwatch.

## Baseline (2026-11-04)

Release build of `main` (`d7c0de1`), 5 runs, `-IdleSeconds 15`, no server profile (the "add a server" screen, no network). Same machine as below.

| Metric | Median | Range |
|---|---|---|
| `window_ms` (first top-level window) | 49 ms | 31-512 ms |
| `ready_ms` (webview loaded, CPU-quiet) | 469 ms | 423-1410 ms |
| Idle private bytes (whole process tree) | 199 MB | 196-202 MB |
| Idle working set (whole process tree) | 416 MB | 414-430 MB |

Notes: run 1 was the first start of the session and the slowest (512 ms and 1410 ms); runs 2-5 were 31-51 ms and 423-483 ms. All runs had 7 processes (the app plus its WebView2 helpers). `window_ms` this small suggests the window exists before it is painted. Working set double-counts pages shared between WebView2 processes; private bytes is the figure to quote. The OS file cache stays warm between runs, so these are not cold-disk numbers. The build for this run took 8 min 4 s (`tauri build --no-bundle` without the `tsc` step) and produced a 25.3 MB `keystone-desktop.exe`.

## Measured without a window

Machine: AMD Ryzen 5 7600 (6 cores, 12 threads), 31 GB RAM, Windows 11 Pro 10.0.26300.

| Item | Value | How |
|---|---|---|
| Release binary `keystone-desktop.exe` | 24.2 MB | `tauri build --no-bundle`, file size |
| Web bundle (`desktop/dist`) | 3.8 MB, 321 files | `vite build --config vite.desktop.config.ts`, directory size |
| Release build from a clean `target/` | 7 min 22 s | `tauri build --no-bundle`, Cargo's own timing, includes vendored OpenSSL/SQLCipher |
