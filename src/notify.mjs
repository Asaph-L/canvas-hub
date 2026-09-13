import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadConfig, log, hkTime, desktopNotify } from './util.mjs';
import { lark, larkUserOpenId } from './larkrun.mjs';

function readState() {
  const p = path.join(ROOT, 'data', 'state.json');
  if (!fs.existsSync(p)) return { courses: {} };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function macosNotify(title, body) {
  desktopNotify(title, body);
}
function hkDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date());
}

function summarize(s) {
  const now = Date.now();
  const DAY = 86400000;
  const dues = [];
  for (const c of Object.values(s.courses)) {
    for (const a of c.assignments || []) {
      if (!a.due_at) continue;
      const days = (new Date(a.due_at).getTime() - now) / DAY;
      if (days >= -1 && days <= 7) dues.push({ course: c.folder, name: a.name, due: a.due_at, days, submitted: !!a.submission?.submitted_at });
    }
  }
  dues.sort((a, b) => a.due.localeCompare(b.due));
  const newFiles = [];
  for (const c of Object.values(s.courses)) {
    for (const f of Object.values(c.files || {})) {
      if (f.downloadedAt && now - new Date(f.downloadedAt).getTime() < DAY) newFiles.push(f.path);
    }
  }
  const totalFiles = Object.values(s.courses).reduce((n, c) => n + Object.keys(c.files || {}).length, 0);
  return { dues, newFiles, totalFiles };
}

export async function notify() {
  const cfg = loadConfig();
  const s = readState();
  const { dues, newFiles, totalFiles } = summarize(s);
  const dateStr = new Intl.DateTimeFormat('zh-HK', { timeZone: 'Asia/Hong_Kong', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date());
  const lines = [];
  lines.push('📚 **Canvas 每日摘要**（' + dateStr + '）');
  lines.push('');
  lines.push('**⏰ 未来 7 天截止**');
  if (!dues.length) lines.push('✅ 无临近截止');
  else {
    for (const d of dues) {
      const label = d.days < 0 ? '已过期' : d.days < 1 ? '今天' : Math.ceil(d.days) + ' 天后';
      lines.push('- ' + (d.submitted ? '✅' : '❗') + ' [' + d.course + '] ' + d.name + ' — ' + hkTime(d.due) + '（' + label + '）');
    }
  }
  lines.push('');
  lines.push('**🆕 新文件（24h）**');
  if (!newFiles.length) lines.push('无');
  else newFiles.slice(0, 10).forEach((p) => lines.push('- ' + p));
  lines.push('');
  lines.push('📁 ' + Object.keys(s.courses).length + ' 门课 · ' + totalFiles + ' 个文件 · 仪表盘已更新');
  const md = lines.join('\n');

  if (cfg.channels?.macos !== false) macosNotify('Canvas 课程管家', '摘要已生成：7 天内截止 ' + dues.length + ' 项，新文件 ' + newFiles.length + ' 个');
  if (cfg.channels?.larkIM !== false) {
    const openId = larkUserOpenId();
    if (!openId) log('⏭️ 飞书推送跳过：config.lark.userOpenId 未配置（可运行 node cli.mjs lark-setup）');
    else {
      const r = lark(['im', '+messages-send', '--as', 'bot', '--user-id', openId, '--markdown', md, '--idempotency-key', 'canvas-digest-' + hkDate()]);
      if (r.ok) log('📨 飞书摘要已发送');
      else log('❌ 飞书发送失败：' + (r.err || r.raw).slice(0, 200));
    }
  }
}

export async function eveningNotify() {
  const cfg = loadConfig();
  const s = readState();
  const dues = [];
  for (const c of Object.values(s.courses)) {
    for (const a of c.assignments || []) {
      if (!a.due_at || a.submission?.submitted_at) continue;
      const days = (new Date(a.due_at).getTime() - Date.now()) / 86400000;
      if (days >= -0.05 && days <= 1.5) dues.push({ course: c.folder, name: a.name, due: a.due_at });
    }
  }
  if (!dues.length) { log('🌙 晚间检查：明后天没有未交的截止，不打扰。'); return; }
  dues.sort((a, b) => a.due.localeCompare(b.due));
  const md = '🌙 **Canvas 晚间截止提醒**\n\n' + dues.map((d) => '- ❗ [' + d.course + '] ' + d.name + ' — ' + hkTime(d.due)).join('\n');
  if (cfg.channels?.macos !== false) macosNotify('Canvas 截止提醒', '明天截止：' + dues.map((d) => d.name).join('、'));
  if (cfg.channels?.larkIM !== false) {
    const openId = larkUserOpenId();
    if (!openId) log('⏭️ 飞书晚间提醒跳过：config.lark.userOpenId 未配置');
    else {
      const r = lark(['im', '+messages-send', '--as', 'bot', '--user-id', openId, '--markdown', md, '--idempotency-key', 'canvas-evening-' + hkDate()]);
      if (r.ok) log('📨 飞书晚间提醒已发送（' + dues.length + ' 项）');
      else log('❌ 飞书发送失败：' + (r.err || r.raw).slice(0, 200));
    }
  }
}
