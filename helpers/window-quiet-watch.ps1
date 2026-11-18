<#
  window-quiet-watch.ps1 — 静默运行的后台执行器。

  为什么需要它：光靠提示词让模型"记得把窗口移走"不可靠。这个脚本由插件在启动时
  拉起，持续监视屏幕上新出现的窗口；只要当前会话的「静默运行」是开启状态，就把
  新窗口立刻移到可视区之外，完全不依赖模型是否照做。

  用法（一般由插件自动启动，不需要手动跑）：
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File window-quiet-watch.ps1 `
        -StateUrl "http://127.0.0.1:59898/dsh-quiet-run/state"

  行为：
  - 每 IntervalMs 毫秒问一次开关状态（quiet 为 true 才动手）
  - 只处理"上一轮没有、这一轮新出现"的窗口，已经在屏幕上的不动
  - 跳过系统外壳窗口（任务栏、开始菜单、输入法、桌面等），避免误伤
  - 移走的窗口记到 $env:TEMP\dsh-quiet-windows.json，可用 window-quiet.ps1 -Action show 还原
#>
param(
  [string]$FlagFile,
  [string]$StateUrl,
  [int]$IntervalMs = 700,
  [int]$X = 20000,
  [int]$Y = 20000
)

$ErrorActionPreference = 'Continue'

$sig = @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class QWatchWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int Left, Top, Right, Bottom; }

  public static List<string> List() {
    var acc = new List<string>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(1024);
      GetWindowTextW(h, sb, 1024);
      var title = sb.ToString();
      if (title.Length == 0) return true;
      var cb = new StringBuilder(256);
      GetClassNameW(h, cb, 256);
      uint pid; GetWindowThreadProcessId(h, out pid);
      RECT r; GetWindowRect(h, out r);
      acc.Add(h.ToInt64() + "|" + pid + "|" + r.Left + "|" + r.Top + "|" + (r.Right - r.Left) + "|" + (r.Bottom - r.Top) + "|" + cb.ToString() + "|" + title);
      return true;
    }, IntPtr.Zero);
    return acc;
  }

  public static bool Move(IntPtr h, int x, int y, int cx, int cy) {
    return SetWindowPos(h, IntPtr.Zero, x, y, cx, cy, 0x0014);
  }
}
'@

if (-not ('QWatchWin' -as [type])) {
  Add-Type -TypeDefinition $sig -ErrorAction Stop
}

$logFile = Join-Path $env:TEMP 'dsh-quiet-watch.log'
$stateFile = Join-Path $env:TEMP 'dsh-quiet-windows.json'
$pidFile = Join-Path (Split-Path -Parent $FlagFile) 'watcher.pid'

function Log([string]$message) {
  $line = (Get-Date).ToString('HH:mm:ss.fff') + '  ' + $message
  try { Add-Content -Path $logFile -Value $line -Encoding UTF8 } catch { }
}

# 单实例：插件每次热重载都会尝试拉起监视器，这里由脚本自己保证只有一个
try {
  if (Test-Path $pidFile) {
    $old = (Get-Content $pidFile -Raw -Encoding UTF8).Trim()
    if ($old -and $old -ne "$PID") {
      $alive = Get-Process -Id ([int]$old) -ErrorAction SilentlyContinue
      if ($alive) {
        Log "已有监视器在运行（PID $old），本实例退出"
        exit 0
      }
    }
  }
  [System.IO.File]::WriteAllText($pidFile, "$PID", (New-Object System.Text.UTF8Encoding($false)))
} catch { }

# 不该被移动的窗口：系统外壳、输入法、桌面、以及我们自己的进程
$skipClasses = @(
  'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Progman', 'WorkerW', 'NotifyIconOverflowWindow',
  'Windows.UI.Core.CoreWindow', 'ApplicationFrameWindow_Hidden', 'DV2ControlHost',
  'MsgrIMEWindowClass', 'IME', 'ConsoleWindowClass'
)
$skipProcessNames = @(
  'explorer', 'SearchHost', 'StartMenuExperienceHost', 'ShellExperienceHost', 'TextInputHost',
  'ApplicationFrameHost', 'LockApp', 'Widgets', 'SystemSettings', 'powershell', 'pwsh',
  'conhost', 'WindowsTerminal'
)

function Get-WindowSnapshot {
  $rows = @()
  foreach ($line in [QWatchWin]::List()) {
    $p = $line -split '\|', 8
    $rows += [pscustomobject]@{
      handle = [int64]$p[0]; pid = [int]$p[1]
      left = [int]$p[2]; top = [int]$p[3]; width = [int]$p[4]; height = [int]$p[5]
      klass = $p[6]; title = $p[7]
    }
  }
  return $rows
}

function Should-Skip($w) {
  if ($skipClasses -contains $w.klass) { return $true }
  try {
    $proc = Get-Process -Id $w.pid -ErrorAction Stop
    if ($skipProcessNames -contains $proc.ProcessName) { return $true }
  } catch { }
  # 窗口比 40x40 小的多为工具提示类，不处理
  if ($w.width -lt 40 -or $w.height -lt 40) { return $true }
  return $false
}

function Save-Restore($w) {
  $list = New-Object System.Collections.ArrayList
  if (Test-Path $stateFile) {
    try {
      $raw = Get-Content $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
      foreach ($item in @($raw)) { if ($item) { [void]$list.Add($item) } }
    } catch { }
  }
  $record = [pscustomobject]@{
    handle = $w.handle; pid = $w.pid; title = $w.title
    left = $w.left; top = $w.top; width = $w.width; height = $w.height
  }
  [void]$list.Add($record)
  $body = ($list | ForEach-Object { $_ | ConvertTo-Json -Depth 5 -Compress }) -join ','
  [System.IO.File]::WriteAllText($stateFile, "[$body]", (New-Object System.Text.UTF8Encoding($false)))
}

Log "watcher 启动，标志文件 '$FlagFile'，状态源 '$StateUrl'，间隔 ${IntervalMs}ms"

# 初始快照：已经打开的窗口视为"已知"，绝不移动它们
$known = New-Object System.Collections.Generic.HashSet[int64]
foreach ($w in Get-WindowSnapshot) { [void]$known.Add($w.handle) }

function Read-Quiet {
  # 优先读插件写的标志文件（不依赖端口），文件太旧就当没开
  if ($FlagFile -and (Test-Path $FlagFile)) {
    try {
      $age = (Get-Date) - (Get-Item $FlagFile).LastWriteTime
      if ($age.TotalSeconds -le 30) {
        $flag = Get-Content $FlagFile -Raw -Encoding UTF8 | ConvertFrom-Json
        return ($flag.quiet -eq $true)
      }
    } catch { }
    return $false
  }
  if ($StateUrl) {
    try {
      $state = Invoke-RestMethod -Uri $StateUrl -TimeoutSec 3 -ErrorAction Stop
      return ($state.quiet -eq $true)
    } catch {
      return $false
    }
  }
  return $false
}

$quiet = $false
$tick = 0
$staleTicks = 0
while ($true) {
  $tick++

  # 宿主已经不写标志文件了（DSH 退出/崩溃），连续 10 分钟没动静就自行退出，别留孤儿进程
  if ($FlagFile -and (Test-Path $FlagFile)) {
    if (((Get-Date) - (Get-Item $FlagFile).LastWriteTime).TotalMinutes -gt 10) {
      $staleTicks++
      if ($staleTicks -gt 20) {
        Log '标志文件长期未更新，监视器退出'
        exit 0
      }
    } else {
      $staleTicks = 0
    }
  }

  $quiet = Read-Quiet

  $current = Get-WindowSnapshot
  $currentHandles = New-Object System.Collections.Generic.HashSet[int64]
  foreach ($w in $current) {
    [void]$currentHandles.Add($w.handle)
    if ($known.Contains($w.handle)) { continue }
    # 新出现的窗口
    if (Should-Skip $w) { continue }
    if (-not $quiet) { continue }
    if ($w.left -ge 10000 -or $w.top -ge 10000) { continue }
    $ok = [QWatchWin]::Move([IntPtr]$w.handle, $X, $Y, $w.width, $w.height)
    if ($ok) {
      Save-Restore $w
      Log "已移出：[PID $($w.pid)] $($w.title)"
    } else {
      Log "移动失败（可能全屏独占）：[PID $($w.pid)] $($w.title)"
    }
  }

  # 忘掉已关闭的窗口，避免集合无限增长
  $known = $currentHandles
  Start-Sleep -Milliseconds $IntervalMs
}