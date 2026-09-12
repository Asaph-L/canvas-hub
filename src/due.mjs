import fs from 'node:fs';
import path from 'node:path';
import { ROOT, log, hkTime } from './util.mjs';

export function due({ horizonDays = 10 } = {}) {
  const p = path.join(ROOT, 'data', 'state.json');
  if (!fs.existsSync(p)) { log('还没有同步记录，先运行: node cli.mjs sync'); return; }
  const s = JSON.parse(fs.readFileSync(p, 'utf8'));
  const rows = [];
  for (const c of Object.values(s.courses)) {
    for (const a of c.assignments || []) {
      if (!a.due_at) continue;
      const days = (new Date(a.due_at).getTime() - Date.now()) / 86400000;
      if (days < -1 || days > horizonDays) continue;
      rows.push({ course: c.folder, name: a.name, due_at: a.due_at, days, submitted: !!a.submission?.submitted_at, url: a.url });
    }
  }
  rows.sort((a, b) => a.due_at.localeCompare(b.due_at));
  if (!rows.length) { log('✅ 未来 ' + horizonDays + ' 天内没有截止的作业。'); return; }
  log('⏰ 未来 ' + horizonDays + ' 天内的截止（含今天）：');
  for (const r of rows) {
    const label = r.days < 0 ? '已过期' : r.days < 1 ? '今天' : Math.ceil(r.days) + ' 天后';
    log('   ' + (r.submitted ? '✅' : '❗') + ' [' + r.course + '] ' + r.name + ' — ' + hkTime(r.due_at) + '（' + label + '）' + (r.url || ''));
  }
}
