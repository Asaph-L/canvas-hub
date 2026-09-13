import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 跨平台定时任务：
//   macOS   -> launchd（~/Library/LaunchAgents/*.plist）
//   Windows -> 计划任务（schtasks，配合 VBS 隐藏窗口运行）
//   Linux   -> 打印 crontab 配置（不自动改用户的 crontab）
//
// 用法：node scripts/schedule.mjs install|remove|status
// 环境变量：NODE_BIN / PORT / ENABLE_MORNING / ENABLE_EVENING / ENABLE_WEB / MORNING / EVENING

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const e = process.env;
const NODE_BIN = e.NODE_BIN || process.execPath;
const PORT = String(e.PORT || 8788);
const MORNING = e.MORNING || '08:00';
const EVENING = e.EVENING || '20:00';
const WANT_MORNING = e.ENABLE_MORNING !== '0';
const WANT_EVENING = e.ENABLE_EVENING !== '0';
const WANT_WEB = e.ENABLE_WEB !== '0';
const action = process.argv[2] || 'install';

const MAC_LABELS = { morning: 'com.canvashub.morning', evening: 'com.canvashub.evening', web: 'com.canvashub.web' };
const LEGACY_LABELS = ['com.cityu.canvashub.morning', 'com.cityu.canvashub.evening', 'com.cityu.canvashub.web'];
const WIN_TASKS = { morning: 'CanvasHub-Morning', evening: 'CanvasHub-Evening', web: 'CanvasHub-Web' };

const log = (...a) => console.log(a.join(' '));

/* ---------------- macOS: launchd ---------------- */

function plistXml(opts) {
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">');
  out.push('<plist version="1.0">');
  out.push('<dict>');
  out.push('  <key>Label</key><string>' + opts.label + '</string>');
  out.push('  <key>ProgramArguments</key>');
  out.push('  <array>');
  out.push('    <string>' + NODE_BIN + '</string>');
  for (const a of opts.args) out.push('    <string>' + a + '</string>');
  out.push('  </array>');
  out.push('  <key>WorkingDirectory</key><string>' + ROOT + '</string>');
  if (opts.hour != null) {
    out.push('  <key>StartCalendarInterval</key>');
    out.push('  <dict><key>Hour</key><integer>' + opts.hour + '</integer><key>Minute</key><integer>' + opts.minute + '</integer></dict>');
  }
  if (opts.keepAlive) {
    out.push('  <key>RunAtLoad</key><true/>');
    out.push('  <key>KeepAlive</key><true/>');
  }
  out.push('  <key>StandardOutPath</key><string>' + path.join(ROOT, 'logs', opts.logName + '.log') + '</string>');
  out.push('  <key>StandardErrorPath</key><string>' + path.join(ROOT, 'logs', opts.logName + '.err') + '</string>');
  out.push('  <key>EnvironmentVariables</key>');
  out.push('  <dict>');
  out.push('    <key>PATH</key><string>' + path.dirname(NODE_BIN) + ':/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>');
  out.push('    <key>CANVAS_HUB_PORT</key><string>' + PORT + '</string>');
  out.push('    <key>LARKSUITE_CLI_NO_UPDATE_NOTIFIER</key><string>1</string>');
  out.push('    <key>LARKSUITE_CLI_NO_SKILLS_NOTIFIER</key><string>1</string>');
  out.push('  </dict>');
  out.push('</dict>');
  out.push('</plist>');
  return out.join('\n') + '\n';
}

function macWrite(opts) {
  const xml = plistXml(opts);
  const agents = e.LAUNCH_AGENTS_DIR || path.join(os.homedir(), 'Library', 'LaunchAgents');
  fs.mkdirSync(path.join(ROOT, 'LaunchAgents'), { recursive: true });
  fs.mkdirSync(agents, { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'LaunchAgents', opts.label + '.plist'), xml);
  fs.writeFileSync(path.join(agents, opts.label + '.plist'), xml);
  return agents;
}

function macBootout(label) {
  spawnSync('launchctl', ['bootout', 'gui/' + process.getuid() + '/' + label], { encoding: 'utf8' });
}

// launchd 在 bootout 之后立刻 bootstrap 会偶发失败，这里等待并重试三次
function macBootstrap(label, plistPath) {
  const target = 'gui/' + process.getuid();
  let last = '';
  for (let i = 0; i < 3; i++) {
    const r = spawnSync('launchctl', ['bootstrap', target, plistPath], { encoding: 'utf8' });
    if (r.status === 0) return { ok: true };
    last = ((r.stderr || '') + (r.stdout || '')).trim();
    spawnSync('sleep', ['1']);
  }
  return { ok: false, err: last };
}

function macInstall() {
  const agents = e.LAUNCH_AGENTS_DIR || path.join(os.homedir(), 'Library', 'LaunchAgents');
  for (const legacy of LEGACY_LABELS) {
    macBootout(legacy);
    try { fs.unlinkSync(path.join(agents, legacy + '.plist')); } catch {}
  }
  const wanted = [];
  if (WANT_MORNING) {
    const [h, m] = MORNING.split(':');
    wanted.push({ key: 'morning', label: MAC_LABELS.morning, args: [path.join(ROOT, 'cli.mjs'), 'daily'], hour: Number(h || 8), minute: Number(m || 0), logName: 'launchd-morning' });
  }
  if (WANT_EVENING) {
    const [h, m] = EVENING.split(':');
    wanted.push({ key: 'evening', label: MAC_LABELS.evening, args: [path.join(ROOT, 'cli.mjs'), 'evening'], hour: Number(h || 20), minute: Number(m || 0), logName: 'launchd-evening' });
  }
  if (WANT_WEB) wanted.push({ key: 'web', label: MAC_LABELS.web, args: [path.join(ROOT, 'server.mjs')], keepAlive: true, logName: 'launchd-web' });
  for (const w of wanted) {
    macWrite(w);
    macBootout(w.label);
    spawnSync('sleep', ['1']);
    const res = macBootstrap(w.label, path.join(agents, w.label + '.plist'));
    if (res.ok) log('✅ 已加载定时任务：' + w.label);
    else log('⚠️ 加载失败：' + w.label + (res.err ? '（' + res.err + '）' : '') + '，可稍后手动执行 launchctl bootstrap gui/' + process.getuid() + ' ~/Library/LaunchAgents/' + w.label + '.plist');
  }
}

function macRemove() {
  const agents = e.LAUNCH_AGENTS_DIR || path.join(os.homedir(), 'Library', 'LaunchAgents');
  for (const label of [...Object.values(MAC_LABELS), ...LEGACY_LABELS]) {
    macBootout(label);
    try { fs.unlinkSync(path.join(agents, label + '.plist')); } catch {}
    log('已移除：' + label);
  }
}

function macStatus() {
  for (const label of Object.values(MAC_LABELS)) {
    const r = spawnSync('launchctl', ['list', label], { encoding: 'utf8' });
    const plist = path.join(e.LAUNCH_AGENTS_DIR || path.join(os.homedir(), 'Library', 'LaunchAgents'), label + '.plist');
    const installed = fs.existsSync(plist);
    log((r.status === 0 ? '✅ 运行中：' : installed ? '⚠️ 已安装未加载：' : '❌ 未安装：') + label);
  }
}

/* ---------------- Windows: Task Scheduler ---------------- */

// VBS 只负责「隐藏窗口运行一个 .cmd」；真正的命令与日志重定向写在 .cmd 里，
// 这样 Windows 上也能像 macOS 一样在 logs/ 里看到输出，出问题好排查。
const VBS = [
  'Set sh = CreateObject("WScript.Shell")',
  'If WScript.Arguments.Count = 0 Then WScript.Quit 1',
  'sh.Run """" & WScript.Arguments(0) & """", 0, False',
].join('\r\n');

function winWriteWrapper(name, args, logName) {
  const dir = path.join(ROOT, 'scripts');
  fs.mkdirSync(dir, { recursive: true });
  const vbs = path.join(dir, 'run-hidden.vbs');
  fs.writeFileSync(vbs, VBS + '\r\n');
  const lines = [
    '@echo off',
    'cd /d "%~dp0.."',
    'if not exist "logs" mkdir "logs"',
    '"' + NODE_BIN + '" ' + args.map((a) => '"' + a + '"').join(' ') + ' >> "logs\\' + logName + '.log" 2>&1',
  ];
  const cmdPath = path.join(dir, name);
  fs.writeFileSync(cmdPath, lines.join('\r\n') + '\r\n');
  return { vbs, cmdPath };
}

function winTaskCommand(vbs, cmdPath) {
  return 'wscript.exe "' + vbs + '" "' + cmdPath + '"';
}

const FAKE_WIN = process.env.CANVAS_HUB_FAKE_WIN === '1';

function winCreate(name, tr, schedule) {
  spawnSync('schtasks', ['/Delete', '/F', '/TN', name], { encoding: 'utf8' });
  const args = ['/Create', '/F', '/TN', name, '/TR', tr];
  if (schedule.minute != null) args.push('/SC', 'MINUTE', '/MO', String(schedule.minute));
  else args.push('/SC', 'DAILY', '/ST', schedule.time);
  if (FAKE_WIN) { log('[模拟] schtasks ' + args.join(' ')); return; }
  const r = spawnSync('schtasks', args, { encoding: 'utf8' });
  if (r.status === 0) { log('✅ 已创建计划任务：' + name); return; }
  const detail = ((r.stderr || '') + (r.stdout || '')).trim();
  log('⚠️ 创建失败：' + name + '（exit ' + r.status + '）' + (detail ? ' ' + detail.slice(0, 200) : ' 无输出 —— 常见原因：权限/沙箱限制，请用管理员 PowerShell 重试'));
}

function winRunNow(name) {
  if (FAKE_WIN) { log('[模拟] schtasks /Run /TN ' + name); return; }
  const r = spawnSync('schtasks', ['/Run', '/TN', name], { encoding: 'utf8' });
  if (r.status === 0) { log('▶️  已立即启动：' + name); return; }
  const detail = ((r.stderr || '') + (r.stdout || '')).trim();
  log('⚠️ 立即启动失败：' + name + '（exit ' + r.status + '）' + (detail ? ' ' + detail.slice(0, 160) : ' 无输出 —— 可能是权限限制'));
}

function winInstall() {
  const cli = path.join(ROOT, 'cli.mjs');
  const server = path.join(ROOT, 'server.mjs');
  if (WANT_MORNING) {
    const w = winWriteWrapper('task-morning.cmd', [cli, 'daily'], 'launchd-morning');
    winCreate(WIN_TASKS.morning, winTaskCommand(w.vbs, w.cmdPath), { time: MORNING });
  }
  if (WANT_EVENING) {
    const w = winWriteWrapper('task-evening.cmd', [cli, 'evening'], 'launchd-evening');
    winCreate(WIN_TASKS.evening, winTaskCommand(w.vbs, w.cmdPath), { time: EVENING });
  }
  if (WANT_WEB) {
    const w = winWriteWrapper('task-web.cmd', [server], 'launchd-web');
    // 每 5 分钟检查一次：已在运行则新实例因端口被占用而立即退出，等价于"常驻"
    winCreate(WIN_TASKS.web, winTaskCommand(w.vbs, w.cmdPath), { minute: 5 });
    winRunNow(WIN_TASKS.web);   // 立刻启动，否则要等到下一个 5 分钟边界
  }
  log('提示：可在「任务计划程序」里查看 CanvasHub-* 三个任务；日志在 logs/launchd-*.log。');
}

function winRemove() {
  for (const name of Object.values(WIN_TASKS)) {
    const r = spawnSync('schtasks', ['/Delete', '/F', '/TN', name], { encoding: 'utf8' });
    const detail = ((r.stderr || '') + (r.stdout || '')).trim();
    log((r.status === 0 ? '已移除：' : '（未能移除，exit ' + r.status + '）') + name + (r.status === 0 || !detail ? '' : ' ' + detail.slice(0, 160)));
  }
}

function winStatus() {
  for (const name of Object.values(WIN_TASKS)) {
    const r = spawnSync('schtasks', ['/Query', '/TN', name], { encoding: 'utf8' });
    log((r.status === 0 ? '✅ 已安装：' : '❌ 未安装：') + name);
  }
}

/* ---------------- Linux: 打印 crontab ---------------- */

function linuxHelp() {
  log('Linux 请手动加入 crontab（crontab -e）：');
  if (WANT_MORNING) log(MORNING.split(':')[1] + ' ' + MORNING.split(':')[0] + ' * * * cd "' + ROOT + '" && "' + NODE_BIN + '" cli.mjs daily >> logs/cron.log 2>&1');
  if (WANT_EVENING) log(EVENING.split(':')[1] + ' ' + EVENING.split(':')[0] + ' * * * cd "' + ROOT + '" && "' + NODE_BIN + '" cli.mjs evening >> logs/cron.log 2>&1');
  if (WANT_WEB) log('@reboot cd "' + ROOT + '" && "' + NODE_BIN + '" server.mjs >> logs/web.log 2>&1');
}

/* ---------------- 入口 ---------------- */

const platform = FAKE_WIN ? 'win32' : process.platform;
if (action === 'install') {
  if (platform === 'darwin') macInstall();
  else if (platform === 'win32') winInstall();
  else linuxHelp();
} else if (action === 'remove') {
  if (platform === 'darwin') macRemove();
  else if (platform === 'win32') winRemove();
  else log('Linux：请手动删除 crontab 中的相关行');
} else if (action === 'status') {
  if (platform === 'darwin') macStatus();
  else if (platform === 'win32') winStatus();
  else log('Linux：请查看 crontab -l');
} else {
  log('用法：node scripts/schedule.mjs install|remove|status');
}
