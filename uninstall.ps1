# Canvas 课程管家 · Windows 卸载（移除计划任务，不删除课程资料）
$ErrorActionPreference = 'Continue'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir
$env:NODE_BIN = (Get-Command node -ErrorAction SilentlyContinue).Source

if ($env:NODE_BIN) {
  & $env:NODE_BIN scripts/schedule.mjs remove
} else {
  foreach ($t in @('CanvasHub-Morning', 'CanvasHub-Evening', 'CanvasHub-Web')) {
    schtasks /Delete /F /TN $t 2>$null | Out-Null
    Write-Host "已尝试移除计划任务：$t"
  }
}

Write-Host ''
Write-Host '计划任务已移除；程序目录可以手动删除，课程资料目录不会被删除。'
