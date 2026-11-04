# Keystone desktop performance

Status: **cold-start and idle-memory baselines are pending.** They need a GUI run on a machine that can spare the window; none is recorded here. Nothing below is an estimate of those numbers.

## Method (for the pending baseline)

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

Known caveat: a trial of an earlier revision of the script (before `-MinProcesses`) reported implausibly early ready times, because the CPU looked quiet before the webview helpers had started. The revision in this repository adds that gate but has not been re-run, so the script should be sanity-checked (compare `ready_ms` with a stopwatch) on the first real run.

## Measured without a window

Machine: AMD Ryzen 5 7600 (6 cores, 12 threads), 31 GB RAM, Windows 11 Pro 10.0.26300.

| Item | Value | How |
|---|---|---|
| Release binary `keystone-desktop.exe` | 24.2 MB | `tauri build --no-bundle`, file size |
| Web bundle (`desktop/dist`) | 3.8 MB, 321 files | `vite build --config vite.desktop.config.ts`, directory size |
| Release build from a clean `target/` | 7 min 22 s | `tauri build --no-bundle`, Cargo's own timing, includes vendored OpenSSL/SQLCipher |
