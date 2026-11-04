<#
.SYNOPSIS
  Measures cold start and idle memory of a built Keystone desktop binary (Windows).

.DESCRIPTION
  Build first (from desktop/):
    npm run tauri -- build --no-bundle            # release: src-tauri\..\target\release\keystone-desktop.exe
    npm run tauri -- build --debug --no-bundle    # debug:   target\debug\keystone-desktop.exe

  Per run the script starts the binary and records:
    window_ms  start -> the process owns a top-level window (MainWindowHandle != 0).
               This is "first window"; the webview may not have painted yet.
    ready_ms   start -> (at least MinProcesses processes exist and) the whole process tree (the app and its msedgewebview2
               children) has been CPU-quiet for QuietMs. This is "ready": the page
               has loaded and the app is waiting for input.
    idle_*     IdleSeconds after ready: working set and private bytes, summed over
               the app process and every descendant (msedgewebview2 included).
  Every run is a cold process start (the previous tree is killed first), not a cold
  disk cache: the OS file cache stays warm between runs. The first run of a session
  is reported separately by looking at runs[0] in the JSON.

  The app is started without a profile, so it shows the "add a server" screen and
  never touches the network. Only one instance can run (single-instance plugin).

.EXAMPLE
  pwsh -File scripts/measure-perf.ps1 -Exe target\release\keystone-desktop.exe -Runs 10 -Json perf-release.json
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $Exe,
  [int] $Runs = 10,
  [int] $IdleSeconds = 30,
  [int] $QuietMs = 1000,
  [int] $MinProcesses = 5,
  [double] $QuietCpuPercent = 3,
  [int] $TimeoutSeconds = 60,
  [string] $Json
)

$ErrorActionPreference = 'Stop'
$Exe = (Resolve-Path -LiteralPath $Exe).Path

function Get-Tree([int] $RootPid) {
  $all = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId
  $ids = [System.Collections.Generic.HashSet[int]]::new()
  [void] $ids.Add($RootPid)
  do {
    $before = $ids.Count
    foreach ($p in $all) { if ($ids.Contains([int] $p.ParentProcessId)) { [void] $ids.Add([int] $p.ProcessId) } }
  } while ($ids.Count -gt $before)
  return $ids
}

function Get-TreeStats([int] $RootPid) {
  $cpu = 0.0; $ws = 0L; $priv = 0L; $n = 0
  foreach ($id in (Get-Tree $RootPid)) {
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if (-not $p) { continue }
    $cpu += $p.TotalProcessorTime.TotalMilliseconds
    $ws += $p.WorkingSet64
    $priv += $p.PrivateMemorySize64
    $n++
  }
  [pscustomobject]@{ CpuMs = $cpu; WorkingSet = $ws; Private = $priv; Processes = $n }
}

function Stop-Tree([int] $RootPid) {
  foreach ($id in (Get-Tree $RootPid)) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
}

function Median($xs) {
  $s = @($xs | Sort-Object)
  if ($s.Count -eq 0) { return $null }
  $m = [int][math]::Floor($s.Count / 2)
  if ($s.Count % 2) { return $s[$m] } else { return ($s[$m - 1] + $s[$m]) / 2 }
}

$results = @()
for ($i = 1; $i -le $Runs; $i++) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $proc = Start-Process -FilePath $Exe -PassThru
  $windowMs = $null; $readyMs = $null
  $lastCpu = $null; $lastAt = $null; $quietSince = $null
  try {
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
      Start-Sleep -Milliseconds 20
      $proc.Refresh()
      if ($proc.HasExited) { throw "run ${i}: the app exited early (code $($proc.ExitCode))" }
      if ($null -eq $windowMs -and $proc.MainWindowHandle -ne 0) { $windowMs = $sw.Elapsed.TotalMilliseconds }
      if ($null -eq $windowMs) { continue }
      $now = $sw.Elapsed.TotalMilliseconds
      $stats = Get-TreeStats $proc.Id
      if ($stats.Processes -lt $MinProcesses) { continue }  # the webview helpers are not up yet
      if ($null -ne $lastCpu -and ($now - $lastAt) -ge 100) {
        $pct = 100 * ($stats.CpuMs - $lastCpu) / ($now - $lastAt)
        if ($pct -lt $QuietCpuPercent) {
          if ($null -eq $quietSince) { $quietSince = $lastAt }
          if (($now - $quietSince) -ge $QuietMs) { $readyMs = $quietSince; break }
        } else { $quietSince = $null }
        $lastCpu = $stats.CpuMs; $lastAt = $now
      } elseif ($null -eq $lastCpu) { $lastCpu = $stats.CpuMs; $lastAt = $now }
    }
    if ($null -eq $readyMs) { throw "run ${i}: not ready within ${TimeoutSeconds}s (window_ms=$windowMs)" }
    Start-Sleep -Seconds $IdleSeconds
    $idle = Get-TreeStats $proc.Id
    $row = [pscustomobject]@{
      run = $i
      window_ms = [math]::Round($windowMs)
      ready_ms = [math]::Round($readyMs)
      idle_working_set_mb = [math]::Round($idle.WorkingSet / 1MB, 1)
      idle_private_mb = [math]::Round($idle.Private / 1MB, 1)
      processes = $idle.Processes
    }
    $results += $row
    Write-Host ("run {0}: window {1} ms, ready {2} ms, idle WS {3} MB, private {4} MB, {5} processes" -f $i, $row.window_ms, $row.ready_ms, $row.idle_working_set_mb, $row.idle_private_mb, $row.processes)
  } finally {
    Stop-Tree $proc.Id
    Start-Sleep -Seconds 2
  }
}

$summary = [ordered]@{
  exe = $Exe
  exe_size_mb = [math]::Round((Get-Item -LiteralPath $Exe).Length / 1MB, 1)
  date = (Get-Date).ToString('s')
  os = (Get-CimInstance Win32_OperatingSystem).Caption + ' ' + (Get-CimInstance Win32_OperatingSystem).Version
  cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name
  ram_gb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
  runs = $Runs
  idle_seconds = $IdleSeconds
  median_window_ms = Median ($results.window_ms)
  median_ready_ms = Median ($results.ready_ms)
  min_ready_ms = ($results.ready_ms | Measure-Object -Minimum).Minimum
  max_ready_ms = ($results.ready_ms | Measure-Object -Maximum).Maximum
  median_idle_working_set_mb = Median ($results.idle_working_set_mb)
  median_idle_private_mb = Median ($results.idle_private_mb)
  results = $results
}
$summary | ConvertTo-Json -Depth 4 | ForEach-Object { if ($Json) { Set-Content -LiteralPath $Json -Value $_ -Encoding utf8 } else { $_ } }
Write-Host ("median: window {0} ms, ready {1} ms, idle WS {2} MB, private {3} MB" -f $summary.median_window_ms, $summary.median_ready_ms, $summary.median_idle_working_set_mb, $summary.median_idle_private_mb)
