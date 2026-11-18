<#
  window-quiet.ps1 — 把窗口挪到屏幕外 / 还原。

  用途：静默运行模式下启动 GUI（游戏、编辑器、浏览器预览）后，立刻把窗口移到
  可视区域之外，避免挡住用户、抢走焦点；需要用户亲眼看时再把它移回来。

  用法：
    # 列出当前可见窗口（句柄|PID|left,top|caption）
    pwsh -File window-quiet.ps1 -Action list

    # 把记事本窗口挪走
    pwsh -File window-quiet.ps1 -Action hide -Title "记事本"

    # 按进程号挪（适合刚启动、还不确定标题的程序）
    pwsh -File window-quiet.ps1 -Action hide -ProcessId 12345

    # 全部还原
    pwsh -File window-quiet.ps1 -Action show

  说明：
  - 只按"可见且标题非空"的顶层窗口匹配，避免误伤系统窗口。
  - 挪走前会把原坐标记到临时文件，-Action show 时原位还原。
  - 全屏独占的窗口挪不动，这是 Windows 的限制，此脚本会返回失败并说明。
#>
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('list', 'hide', 'show')]
  [string]$Action,

  [string]$Title,
  [int]$ProcessId = 0,
  [int]$WaitSeconds = 10,
  [int]$X = 20000,
  [int]$Y = 20000
)

$ErrorActionPreference = 'Stop'

$sig = @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class DshWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
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
      uint pid; GetWindowThreadProcessId(h, out pid);
      RECT r; GetWindowRect(h, out r);
      var w = r.Right - r.Left; var ht = r.Bottom - r.Top;
      acc.Add(h.ToInt64() + "|" + pid + "|" + r.Left + "|" + r.Top + "|" + w + "|" + ht + "|" + title);
      return true;
    }, IntPtr.Zero);
    return acc;
  }

  public static string Rect(IntPtr h) {
    RECT r; GetWindowRect(h, out r);
    return r.Left + "," + r.Top + "," + (r.Right - r.Left) + "," + (r.Bottom - r.Top);
  }

  public static bool Move(IntPtr h, int x, int y, int cx, int cy) {
    // SWP_NOZORDER(0x4) | SWP_NOACTIVATE(0x10) —— 不改层级、不抢焦点
    return SetWindowPos(h, IntPtr.Zero, x, y, cx, cy, 0x0014);
  }
}
'@

if (-not ('DshWin' -as [type])) {
  Add-Type -TypeDefinition $sig -ErrorAction Stop
}

$stateFile = Join-Path $env:TEMP 'dsh-quiet-windows.json'

function Read-State {
  if (-not (Test-Path $stateFile)) { return @() }
  try {
    $raw = Get-Content $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    return @()
  }
  $flat = New-Object System.Collections.ArrayList
  foreach ($item in @($raw)) {
    if ($null -eq $item) { continue }
    if ($item -is [System.Array]) {
      foreach ($inner in $item) { if ($inner) { [void]$flat.Add($inner) } }
    } else {
      [void]$flat.Add($item)
    }
  }
  return $flat.ToArray()
}

function Write-State($rows) {
  $flat = New-Object System.Collections.ArrayList
  foreach ($item in @($rows)) {
    if ($null -eq $item) { continue }
    if ($item -is [System.Array]) { foreach ($inner in $item) { if ($inner) { [void]$flat.Add($inner) } } }
    else { [void]$flat.Add($item) }
  }
  if ($flat.Count -eq 0) {
    Remove-Item $stateFile -ErrorAction SilentlyContinue
    return
  }
  # 手工拼 JSON 数组，避免单元素被 ConvertTo-Json 序列化成对象
  $body = ($flat | ForEach-Object { $_ | ConvertTo-Json -Depth 5 -Compress }) -join ','
  [System.IO.File]::WriteAllText($stateFile, "[$body]", (New-Object System.Text.UTF8Encoding($false)))
}

$all = [DshWin]::List() | ForEach-Object {
  $p = $_ -split '\|', 7
  [pscustomobject]@{
    handle = [int64]$p[0]; pid = [int]$p[1]
    left = [int]$p[2]; top = [int]$p[3]; width = [int]$p[4]; height = [int]$p[5]
    title = $p[6]
  }
}

switch ($Action) {
  'list' {
    if (-not $all) { '（没有可见窗口）'; break }
    $all | ForEach-Object { "{0}|{1}|{2},{3}|{4}x{5}|{6}" -f $_.handle, $_.pid, $_.left, $_.top, $_.width, $_.height, $_.title }
    break
  }

  'hide' {
    # 打包应用（如 Win11 记事本、部分商店应用）里，Start-Process 拿到的 PID
    # 常常不是真正拥有窗口的那个进程，所以这里把子进程也纳入匹配，
    # 并且轮询等待窗口出现（GUI 启动需要时间）。
    $candidatePids = New-Object System.Collections.Generic.HashSet[int]
    if ($ProcessId -gt 0) {
      [void]$candidatePids.Add($ProcessId)
      try {
        $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue |
          Select-Object -ExpandProperty ProcessId
        foreach ($childPid in @($children)) { [void]$candidatePids.Add([int]$childPid) }
      } catch {
        # 拿不到进程树就只按原 PID 匹配
      }
    }

    $matched = @()
    $deadline = (Get-Date).AddSeconds([Math]::Max(0, $WaitSeconds))
    while ($true) {
      $snapshot = [DshWin]::List() | ForEach-Object {
        $p = $_ -split '\|', 7
        [pscustomobject]@{
          handle = [int64]$p[0]; pid = [int]$p[1]
          left = [int]$p[2]; top = [int]$p[3]; width = [int]$p[4]; height = [int]$p[5]
          title = $p[6]
        }
      }
      $matched = @($snapshot)
      if ($candidatePids.Count -gt 0) { $matched = @($matched | Where-Object { $candidatePids.Contains([int]$_.pid) }) }
      if ($Title) { $matched = @($matched | Where-Object { $_.title -like "*$Title*" }) }
      if ($matched.Count -gt 0) { break }
      if ((Get-Date) -ge $deadline) { break }
      Start-Sleep -Milliseconds 250
    }

    if ($matched.Count -eq 0) {
      "未匹配到窗口（Title='$Title' ProcessId=$ProcessId，已等待 $WaitSeconds 秒）" | Write-Error
      exit 1
    }

    $state = @(Read-State)
    foreach ($w in $matched) {
      # 已经在屏幕外的不要重复记，避免 -Action show 时坐标被覆盖成 20000
      $alreadyOut = ($w.left -ge 10000) -or ($w.top -ge 10000)
      $ok = [DshWin]::Move([IntPtr]$w.handle, $X, $Y, $w.width, $w.height)
      if (-not $ok) {
        "移动失败（可能是全屏独占窗口）：$($w.title)"
        continue
      }
      if (-not $alreadyOut) {
        $state += [pscustomobject]@{
          handle = $w.handle; pid = $w.pid; title = $w.title
          left = $w.left; top = $w.top; width = $w.width; height = $w.height
        }
      }
      "已移出可视区：$($w.title) [PID $($w.pid)] → ($X,$Y)"
    }
    Write-State $state
    break
  }

  'show' {
    $state = @(Read-State)
    if (-not $state -or $state.Count -eq 0) {
      '没有记录到需要还原的窗口'
      break
    }
    $remaining = New-Object System.Collections.ArrayList
    foreach ($s in $state) {
      $handle = [int64]$s.handle
      $ok = [DshWin]::Move([IntPtr]$handle, [int]$s.left, [int]$s.top, [int]$s.width, [int]$s.height)
      if ($ok) {
        "已还原：$($s.title) → ($($s.left),$($s.top))"
      } else {
        "还原失败（窗口可能已关闭）：$($s.title)"
        [void]$remaining.Add($s)
      }
    }
    Write-State $remaining.ToArray()
    break
  }
}