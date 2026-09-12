import fs from 'node:fs';
import path from 'node:path';
import { ROOT, log, hkTime } from './util.mjs';

const DAY = 86400000;

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / DAY + 1) / 7);
  return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}

export function digest() {
  const statePath = path.join(ROOT, 'data', 'state.json');
  if (!fs.existsSync(statePath)) { log('没有同步数据，先运行 node cli.mjs sync'); return; }
  const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const now = new Date();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(now);

  const dues = [];
  for (const c of Object.values(s.courses)) {
    for (const a of c.assignments || []) {
      if (!a.due_at) continue;
      const days = (new Date(a.due_at).getTime() - now.getTime()) / DAY;
      if (days >= -1 && days <= 7) dues.push({ course: c.folder, name: a.name, due: a.due_at, days, submitted: !!a.submission?.submitted_at });
    }
  }
  dues.sort((a, b) => a.due.localeCompare(b.due));

  const newFiles = [];
  for (const c of Object.values(s.courses)) {
    for (const f of Object.values(c.files || {})) {
      const t = f.downloadedAt;
      if (t && now.getTime() - new Date(t).getTime() < DAY) newFiles.push(f.path);
    }
  }

  const L = [];
  L.push('# 📚 Canvas 每日摘要 — ' + day, '');
  L.push('## ⏰ 截止提醒（未来 7 天）', '');
  if (!dues.length) L.push('✅ 没有即将截止的作业。');
  else for (const d of dues) {
    const label = d.days < 0 ? '已过期' : d.days < 1 ? '今天' : Math.ceil(d.days) + ' 天后';
    L.push('- ' + (d.submitted ? '✅' : '❗') + ' **[' + d.course + ']** ' + d.name + ' — ' + hkTime(d.due) + '（' + label + '）');
  }
  L.push('');
  L.push('## 🆕 新下载文件（24 小时内）', '');
  if (!newFiles.length) L.push('无。');
  else for (const p of newFiles) L.push('- ' + p);
  L.push('');
  L.push('## 📁 课程总览', '');
  for (const c of Object.values(s.courses)) {
    const byCat = {};
    for (const f of Object.values(c.files || {})) byCat[f.category] = (byCat[f.category] || 0) + 1;
    const sub = (c.assignments || []).filter((a) => a.submission?.submitted_at).length;
    L.push('### ' + c.folder, '');
    L.push('- 文件：' + Object.keys(c.files || {}).length + ' 个（' + Object.entries(byCat).map(([k, v]) => k + ' ' + v).join('、') + '）');
    L.push('- 作业：' + (c.assignments || []).length + ' 个，已提交 ' + sub + ' 个');
    if (c.grades?.current_score != null) L.push('- 当前成绩：' + c.grades.current_score + '%' + (c.grades.current_grade ? '（' + c.grades.current_grade + '）' : ''));
    for (const comp of c.assessment?.components || []) {
      if (comp.reqIfOthersAvg != null) L.push('- ⚠️ ' + comp.name + '（' + comp.weight + '%）按当前水平需 ≥' + comp.reqIfOthersAvg + '% 可保总分 ' + (c.safety?.target ?? 60));
    }
    L.push('');
  }
  L.push('> 数据来源：Canvas API · 同步于 ' + (s.syncedAt || ''));

  const outDir = path.join(ROOT, 'out', 'digest');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, day + '.md'), L.join('\n'));
  log('✅ 已生成每日摘要：out/digest/' + day + '.md');

  if (now.getDay() === 0) {
    const week = isoWeek(now);
    const w = [];
    w.push('# 📚 Canvas 周报 — ' + week, '');
    w.push('## 本周概览', '');
    for (const c of Object.values(s.courses)) {
      const sub = (c.assignments || []).filter((a) => a.submission?.submitted_at).length;
      w.push('- **' + c.folder + '**：文件 ' + Object.keys(c.files || {}).length + ' 个，作业 ' + (c.assignments || []).length + ' 个（已交 ' + sub + '）');
    }
    w.push('');
    w.push('## 未来 7 天截止', '');
    const weekDues = [];
    for (const c of Object.values(s.courses)) for (const a of c.assignments || []) {
      if (!a.due_at) continue;
      const t = new Date(a.due_at).getTime();
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      if (t >= start.getTime() && t < start.getTime() + 7 * DAY) weekDues.push({ course: c.folder, name: a.name, due: a.due_at, submitted: !!a.submission?.submitted_at });
    }
    weekDues.sort((a, b) => a.due.localeCompare(b.due));
    if (!weekDues.length) w.push('无。');
    else for (const d of weekDues) w.push('- ' + (d.submitted ? '✅' : '❗') + ' **[' + d.course + ']** ' + d.name + ' — ' + hkTime(d.due));
    w.push('');
    w.push('> 数据来源：Canvas API · 同步于 ' + (s.syncedAt || ''));
    fs.writeFileSync(path.join(outDir, week + '.md'), w.join('\n'));
    log('✅ 周日已生成周报：out/digest/' + week + '.md');
  }
}
