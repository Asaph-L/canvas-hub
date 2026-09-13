# Canvas 课程管家 · Windows 安装向导
#  交互式：   powershell -ExecutionPolicy Bypass -File install.ps1
#  无人值守： $env:NONINTERACTIVE='1'; $env:CANVAS_TOKEN='xxx'; powershell -ExecutionPolicy Bypass -File install.ps1
#
# 可覆盖的环境变量：CANVAS_URL / CANVAS_TOKEN / FILES_DIR / DEEPSEEK_KEY / TARGET_DIR / PORT
#                   ENABLE_WEB / ENABLE_SCHEDULE / ENABLE_LARK / MORNING / EVENING / ENABLE_DEMO / WEB_LANG

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$NonInteractive = ($env:NONINTERACTIVE -eq '1')

function Ok($m) { Write-Host "✅ $m" -ForegroundColor Green }
function Warn2($m) { Write-Host "⚠️  $m" -ForegroundColor Yellow }
function Err2($m) { Write-Host "❌ $m" -ForegroundColor Red }

function Ask($prompt, $default) {
  if ($NonInteractive) { return $default }
  $shown = if ($default) { "$prompt [$default]" } else { $prompt }
  $ans = Read-Host $shown
  if ([string]::IsNullOrWhiteSpace($ans)) { return $default }
  return $ans
}

function AskYesNo($prompt, $default) {
  if ($NonInteractive) { return ($default -eq 'Y') }
  $ans = Read-Host "$prompt [y/n，默认 $default]"
  if ([string]::IsNullOrWhiteSpace($ans)) { $ans = $default }
  return ($ans -match '^(y|Y|yes|YES|是)$')
}

function AskSecret($prompt, $default) {
  if ($NonInteractive) { return $default }
  $sec = Read-Host $prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  if ([string]::IsNullOrWhiteSpace($plain)) { return $default }
  return $plain
}

Write-Host "==============================================="
Write-Host "   Canvas 课程管家 · Windows 安装向导"
Write-Host "==============================================="
Write-Host "本向导会："
Write-Host "  1. 把程序安装到你指定的目录"
Write-Host "  2. 填入你自己的 Canvas Token（只保存在本机）"
Write-Host "  3. 可选开启：Windows 通知 / Web 看板 / 计划任务 / 飞书集成"
Write-Host "  4. 立即同步一次，验证一切正常"
Write-Host "所有数据都只在你自己的电脑上，不会上传到任何服务器。"
Write-Host ""

# ---------- 1. Node ----------
$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) {
  Warn2 '未检测到 Node.js（程序运行需要它）'
  $Winget = (Get-Command winget -ErrorAction SilentlyContinue).Source
  if ($Winget) {
    if (AskYesNo '是否现在用 winget 自动安装 Node.js LTS（约 1-2 分钟）' 'Y') {
      & $Winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
      $Node = (Get-Command node -ErrorAction SilentlyContinue).Source
    }
  } else {
    Write-Host '    没有检测到 winget，请到 nodejs.org 下载 LTS 安装包（双击安装即可）'
  }
  if (-not $Node) { Err2 '仍未检测到 Node.js，安装中止'; exit 1 }
}
$NodeVersion = (& $Node -v)
Ok "Node $NodeVersion（$Node）"
Write-Host ""

# ---------- 2. 目录 ----------
$TargetDir = if ($env:TARGET_DIR) { $env:TARGET_DIR } else { Ask '程序安装到哪个目录' (Join-Path $HOME 'Desktop\canvas-hub') }
if (-not (Test-Path $TargetDir)) { New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null }
$targetFull = (Resolve-Path $TargetDir).Path
if ($targetFull -ne (Resolve-Path $ScriptDir).Path) {
  Ok "正在复制程序文件到 $targetFull …"
  $exclude = @('data', 'logs', 'dist', 'secrets.json', 'config.json', '.git', 'LaunchAgents')
  Get-ChildItem -Path $ScriptDir -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $targetFull -Recurse -Force
  }
} else {
  Ok '就地安装（程序目录即安装目录）'
}
Set-Location $targetFull

$FilesDir = if ($env:FILES_DIR) { $env:FILES_DIR } else { Ask '课程文件保存到哪个目录（不存在会自动创建）' (Join-Path $HOME 'Desktop\CityU-Courses') }
if (-not (Test-Path $FilesDir)) { New-Item -ItemType Directory -Path $FilesDir -Force | Out-Null }
Ok "课程资料目录：$FilesDir"
Write-Host ""

# ---------- 3. Canvas ----------
$CanvasUrl = if ($env:CANVAS_URL) { $env:CANVAS_URL } else { Ask 'Canvas 地址' 'https://canvas.cityu.edu.hk' }
$CanvasUrl = $CanvasUrl.TrimEnd('/')

$CanvasToken = if ($env:CANVAS_TOKEN) { $env:CANVAS_TOKEN } else { '' }
$attempt = 0
while ([string]::IsNullOrWhiteSpace($CanvasToken) -and $attempt -lt 3) {
  if (-not $NonInteractive) {
    Write-Host ''
    Write-Host '获取 Canvas Token（约 30 秒）：'
    Write-Host '   Canvas 右上角头像 → 账户/Account → 设置/Settings'
    Write-Host '   → 已批准集成/Approved Integrations → + New Access Token → 复制生成的字符串'
  }
  $CanvasToken = AskSecret '粘贴 Canvas Token（输入时不显示）' ''
  $attempt++
}

if (-not [string]::IsNullOrWhiteSpace($CanvasToken)) {
  try {
    $resp = Invoke-RestMethod -Uri "$CanvasUrl/api/v1/users/self" -Headers @{ Authorization = "Bearer $CanvasToken" } -TimeoutSec 25
    Ok "Canvas 连接成功，账号：$($resp.name)"
  } catch {
    Warn2 "Canvas 校验失败（$($_.Exception.Message)），之后可用 node cli.mjs doctor 复查"
  }
} else {
  Warn2 '未填写 Canvas Token，同步功能不可用（可在 config.json / secrets.json 里补）'
}
Write-Host ''

# ---------- 4. DeepSeek ----------
$DeepSeekKey = if ($env:DEEPSEEK_KEY) { $env:DEEPSEEK_KEY } else { '' }
if (-not $NonInteractive) {
  Write-Host 'DeepSeek API Key（可选）：用于对话助手、大纲权重解析、智能分类。'
  Write-Host '   获取：https://platform.deepseek.com → API Keys → 创建'
  Write-Host '   费用提示：按用量计费，日常使用大约每月几毛到几块钱；首次解析大纲时会一次性消耗稍多。'
  $DeepSeekKey = AskSecret '粘贴 DeepSeek API Key（没有就直接回车跳过）' ''
}
if ($DeepSeekKey) { Ok 'DeepSeek Key 已记录' } else { Warn2 '未填 DeepSeek Key：对话与智能解析不可用，其余功能正常' }
Write-Host ''

# ---------- 5. 功能开关 ----------
$EnableWeb = if ($env:ENABLE_WEB) { $env:ENABLE_WEB } else { if (AskYesNo '启用 Web 看板（含日历、对话、设置，默认 8788 端口）' 'Y') { '1' } else { '0' } }
$EnableSchedule = if ($env:ENABLE_SCHEDULE) { $env:ENABLE_SCHEDULE } else { if (AskYesNo '启用计划任务（每天自动同步 + 截止提醒）' 'Y') { '1' } else { '0' } }
$Morning = if ($env:MORNING) { $env:MORNING } else { if ($EnableSchedule -eq '1') { Ask '每天几点同步' '08:00' } else { '08:00' } }
$Evening = if ($env:EVENING) { $env:EVENING } else { if ($EnableSchedule -eq '1') { Ask '每天几点检查次日截止' '20:00' } else { '20:00' } }
$WebLang = if ($env:WEB_LANG) { $env:WEB_LANG } else { if ((Ask '网页看板界面语言：1) 中文（默认） 2) English' '1') -eq '2') { 'en' } else { 'zh' } }
$EnableDemo = if ($env:ENABLE_DEMO) { $env:ENABLE_DEMO } else { '' }
if (-not $EnableDemo) {
  if ($CanvasToken) { $EnableDemo = '0' }
  else {
    Write-Host ''
    Write-Host '还没有 Canvas Token？可以先看演示数据（3 门假课程 + 成绩与安全线示例）体验界面。'
    $EnableDemo = if (AskYesNo '生成演示数据' 'Y') { '1' } else { '0' }
  }
}

$EnableLark = if ($env:ENABLE_LARK) { $env:ENABLE_LARK } else {
  Write-Host ''
  Write-Host '飞书集成（可选）：截止日期进飞书日历、数据存飞书多维表格、摘要发到飞书。'
  Write-Host '   需要先安装 lark-cli 并用自己的飞书账号授权一次；不启用完全不影响其它功能。'
  if (AskYesNo '启用飞书集成' 'N') { '1' } else { '0' }
}
$LarkCli = ''
if ($EnableLark -eq '1') {
  $LarkCli = (Get-Command lark-cli -ErrorAction SilentlyContinue).Source
  if (-not $LarkCli) {
    Warn2 '未找到 lark-cli。请先运行：npx @larksuite/cli@latest install'
    Warn2 '安装完成后重新运行本脚本，或手动执行 node cli.mjs lark-setup'
    $EnableLark = '0'
  }
}

$Port = if ($env:PORT) { $env:PORT } else { '8788' }
$MacFlag = '0'
$LarkFlag = if ($EnableLark -eq '1') { '1' } else { '0' }
$Exclude = ''
if ($CanvasUrl -match 'cityu') { $Exclude = 'SD_ANTI_DECEPTION,SD_CASH' }

Write-Host ''
Ok '正在写入配置 …'
$env:CANVAS_URL = $CanvasUrl
$env:CANVAS_TOKEN = $CanvasToken
$env:DEEPSEEK_KEY = $DeepSeekKey
$env:FILES_DIR = $FilesDir
$env:PORT = $Port
$env:MACOS = $MacFlag
$env:LARK = $LarkFlag
$env:LARK_CLI = $LarkCli
$env:MORNING = $Morning
$env:EVENING = $Evening
$env:CANVAS_EXCLUDE = $Exclude
$env:WEB_LANG = $WebLang
& $Node scripts/gen-config.mjs

if ($CanvasToken) {
  Write-Host ''
  Ok '执行首次同步（可能需要 1-2 分钟）…'
  & $Node cli.mjs sync
}

if ($EnableDemo -eq '1') { Write-Host ''; & $Node cli.mjs demo }

if ($EnableSchedule -eq '1' -or $EnableWeb -eq '1') {
  Write-Host ''
  Ok '正在创建计划任务 …'
  $env:ENABLE_MORNING = if ($EnableSchedule -eq '1') { '1' } else { '0' }
  $env:ENABLE_EVENING = if ($EnableSchedule -eq '1') { '1' } else { '0' }
  $env:ENABLE_WEB = if ($EnableWeb -eq '1') { '1' } else { '0' }
  $env:NODE_BIN = $Node
  & $Node scripts/schedule.mjs install
}

if ($EnableWeb -eq '1') {
  Start-Sleep -Seconds 3
  Start-Process "http://127.0.0.1:$Port"
}

if ($EnableLark -eq '1') {
  Write-Host ''
  Write-Host '飞书还差两步（现在或以后都行）：'
  Write-Host '   1) node cli.mjs lark-setup     # 按提示在浏览器/飞书里完成授权'
  Write-Host '   2) node cli.mjs lark-init      # 创建飞书多维表格并绑定'
}

Write-Host ''
Write-Host '==============================================='
Ok '安装完成！'
Write-Host "  程序目录：$targetFull"
Write-Host "  资料目录：$FilesDir"
Write-Host "  Web 看板：http://127.0.0.1:$Port"
Write-Host ''
Write-Host '常用命令（在程序目录执行）：'
Write-Host '  node cli.mjs doctor     # 体检，出问题先跑这个'
Write-Host '  node cli.mjs sync       # 手动同步一次'
Write-Host '  node cli.mjs daily      # 完整流程（同步+摘要+日历+Base+推送）'
Write-Host '  node cli.mjs demo       # 生成演示数据（体验界面）；demo --off 退出'
Write-Host ''
Write-Host '  定时时间、界面语言、课程过滤等都可在 config.json 里随时修改。'
Write-Host ''
Write-Host '卸载：powershell -ExecutionPolicy Bypass -File uninstall.ps1'
Write-Host '==============================================='
Write-Host ''
& $Node cli.mjs doctor
