import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import { ROOT, loadConfig, log } from './util.mjs';
import { larkStatus, larkEnabled, larkBin } from './larkrun.mjs';
import { lanHosts } from './lan.mjs';

function readSettings() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'settings.json'), 'utf8')) || {}; } catch { return {}; }
}

export async function doctor() {
  const rows = [];
  const ok = (m) => rows.push(['✅', m]);
  const warn = (m, fix) => rows.push(['⚠️', m + (fix ? '　→ ' + fix : '')]);
  const bad = (m, fix) => rows.push(['❌', m + (fix ? '　→ ' + fix : '')]);

  ok('运行平台：' + process.platform + ' / Node ' + process.arch + '（' + os.release() + '）');
  const major = Number(String(process.versions.node).split('.')[0]);
  if (major >= 18) ok('Node ' + process.version + '（' + process.execPath + '）');
  else bad('Node 版本过低：' + process.version, 'brew install node');

  const cfg = loadConfig();
  const ch = cfg.channels || {};
  if (cfg.canvas?.token) ok('Canvas Token 已配置（' + (cfg.canvas.baseUrl || '未设置地址') + '）');
  else bad('未配置 Canvas Token', '重新运行 bash install.sh 或编辑 secrets.json');

  if (cfg.canvas?.token && cfg.canvas?.baseUrl) {
    try {
      const res = await fetch(String(cfg.canvas.baseUrl).replace(/\/+$/, '') + '/api/v1/users/self', {
        headers: { Authorization: 'Bearer ' + cfg.canvas.token },
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) { const me = await res.json(); ok('Canvas 连接正常，当前账号：' + me.name); }
      else bad('Canvas 接口返回 HTTP ' + res.status, '检查 token 是否过期（Canvas → 账户 → 设置 → 新建访问令牌）');
    } catch (e) { bad('Canvas 连接失败：' + e.message, '检查网络或 Canvas 地址'); }
  }

  const root = path.resolve(ROOT, cfg.download?.root || '..');
  if (fs.existsSync(root)) {
    try { fs.accessSync(root, fs.constants.W_OK); ok('资料目录可写：' + root); }
    catch { bad('资料目录不可写：' + root, '检查文件夹权限'); }
  } else warn('资料目录不存在：' + root, 'mkdir -p "' + root + '"');

  const statePath = path.join(ROOT, 'data', 'state.json');
  if (fs.existsSync(statePath)) {
    try {
      const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      const courses = Object.keys(s.courses || {}).length;
      const files = Object.values(s.courses || {}).reduce((n, c) => n + Object.keys(c.files || {}).length, 0);
      ok('已同步 ' + courses + ' 门课 / ' + files + ' 个文件，最近同步：' + (s.syncedAt || '未知'));
    } catch { warn('data/state.json 无法解析', '删除该文件后重新同步'); }
  } else warn('还没有同步数据', '运行 node cli.mjs sync');

  if (readSettings().deepseekApiKey) ok('DeepSeek Key 已配置（对话助手 + 大纲解析 + 智能分类可用）');
  else warn('未配置 DeepSeek Key', '在网页「设置」里填入（不填则对话与智能解析不可用，其余功能正常）');

  const port = Number(process.env.CANVAS_HUB_PORT || (cfg.web && cfg.web.port) || 8788);
  try {
    const r = await fetch('http://127.0.0.1:' + port + '/api/state', { signal: AbortSignal.timeout(5000) });
    if (r.ok) ok('Web 看板运行中：http://127.0.0.1:' + port);
    else warn('Web 服务响应异常（HTTP ' + r.status + '）');
  } catch {
    warn('Web 看板未运行', 'launchctl kickstart -k gui/$(id -u)/com.canvashub.web 或 node server.mjs');
  }

  // 手机端看板（PWA 离线看板）：HTTPS + 访问令牌 + 自签证书
  const settings = readSettings();
  const lanPort = Number(process.env.CANVAS_HUB_LAN_PORT || (cfg.web && cfg.web.lanPort) || port + 1);
  const helperPort = Number(process.env.CANVAS_HUB_HELPER_PORT || (cfg.web && cfg.web.helperPort) || port + 2);
  const lanIps = lanHosts().map((h) => h.address);
  if (settings.lanEnabled === false) {
    warn('手机端看板已关闭', '在网页「设置 → 手机配对」中开启局域网访问');
  } else if (!lanIps.length) {
    warn('未找到局域网地址，手机暂时连不上本机', '确认已连上 WiFi（需要 192.168.x / 10.x 之类的私有地址）');
  } else {
    const tlsDir = path.join(ROOT, 'data', 'tls');
    const certOk = ['ca.pem', 'server.pem', 'server.key'].every((f) => fs.existsSync(path.join(tlsDir, f)));
    const alive = await new Promise((resolve) => {
      const req = https.request({ host: lanIps[0], port: lanPort, path: '/api/health', method: 'GET', rejectUnauthorized: false, timeout: 4000 }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    });
    if (alive) ok('手机端看板运行中：https://' + lanIps[0] + ':' + lanPort + '（HTTPS + 访问令牌）');
    else warn('手机端 HTTPS 端口 ' + lanPort + ' 未响应', '重启 Web 服务；若仍失败，检查该端口是否被占用');
    if (certOk) ok('自签证书就绪，手机首次使用先装 CA：http://' + lanIps[0] + ':' + helperPort + '/');
    else warn('自签证书尚未生成', 'Web 服务启动时会自动生成');
  }

  // 后台任务：交给跨平台调度层报告（macOS=launchd / Windows=计划任务 / Linux=crontab）
  const sched = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'schedule.mjs'), 'status'], { encoding: 'utf8' });
  const schedLines = ((sched.stdout || '') + (sched.stderr || '')).trim().split(/\r?\n/).filter(Boolean);
  if (schedLines.length) {
    for (const line of schedLines) {
      const clean = line.replace(/^[✅⚠️❌\s]+/, '').trim();
      if (line.includes('✅')) ok('后台任务：' + clean);
      else if (line.includes('⚠️')) warn('后台任务待处理：' + clean, 'macOS 用 bash install.sh 重装；Windows 用 powershell -File install.ps1');
      else if (line.includes('❌')) warn('后台任务未安装：' + clean, process.platform === 'win32' ? 'powershell -ExecutionPolicy Bypass -File install.ps1' : 'bash install.sh');
      else ok(line);
    }
  } else {
    warn('未能读取后台任务状态', '手动运行 node scripts/schedule.mjs status');
  }

  if (larkEnabled()) {
    const bin = larkBin();
    if (!fs.existsSync(bin) && bin === 'lark-cli') warn('未找到 lark-cli', 'npx @larksuite/cli@latest install');
    else {
      let st = larkStatus();
      if (!st.userReady) { await new Promise((r) => setTimeout(r, 2500)); st = larkStatus(); }  // 网络抖动时重试一次
      if (st.userReady) ok('飞书用户身份就绪：' + (st.userName || '（未知）'));
      else if (!st.reachable) warn('飞书接口暂时不可达（网络问题？）', '稍后重试 node cli.mjs doctor');
      else warn('飞书未登录或授权过期', 'node cli.mjs lark-setup');
      const lj = path.join(ROOT, 'data', 'lark.json');
      if (fs.existsSync(lj)) ok('飞书 Base 已绑定（data/lark.json）');
      else warn('尚未创建飞书 Base', 'node cli.mjs lark-init');
    }
  } else {
    ok('飞书集成未启用（可选功能，跳过检查）');
  }

  log('=== Canvas 课程管家 · 环境自检 ===');
  for (const row of rows) log(row[0] + ' ' + row[1]);
  const badCount = rows.filter((r) => r[0] === '❌').length;
  const warnCount = rows.filter((r) => r[0] === '⚠️').length;
  log('');
  log(badCount ? '❌ 有 ' + badCount + ' 个问题需要处理' + (warnCount ? '，另有 ' + warnCount + ' 项建议' : '') : warnCount ? '✅ 核心功能正常，有 ' + warnCount + ' 项可选建议' : '🎉 一切正常');
}
