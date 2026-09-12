import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadConfig, log, hkTime } from './util.mjs';
import { lark } from './larkrun.mjs';

function readState() {
  const p = path.join(ROOT, 'data', 'state.json');
  if (!fs.existsSync(p)) return { courses: {} };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeState(s) {
  fs.writeFileSync(path.join(ROOT, 'data', 'state.json'), JSON.stringify(s, null, 2));
}
const ts = (iso) => String(Math.floor(new Date(iso).getTime() / 1000));

export async function syncCalendar() {
  const cfg = loadConfig();
  if (cfg.channels?.larkCalendar === false) { log('⏭️ 飞书日历同步已关闭（config.channels.larkCalendar）'); return; }
  const s = readState();
  let created = 0, updated = 0, skipped = 0, failed = 0;
  for (const c of Object.values(s.courses)) {
    for (const a of c.assignments || []) {
      if (!a.due_at) continue;
      const hash = a.due_at + '|' + a.name;
      const data = {
        summary: '[' + c.folder + '] ' + a.name,
        start_time: { timestamp: ts(a.due_at), timezone: 'Asia/Hong_Kong' },
        end_time: { timestamp: String(Number(ts(a.due_at)) + 3600), timezone: 'Asia/Hong_Kong' },
        description_rich: '**课程**：' + c.folder + '\n**截止**：' + hkTime(a.due_at) + (a.url ? '\n**Canvas 链接**：' + a.url : ''),
        reminders: [{ minutes: 1440 }, { minutes: 60 }],
        free_busy_status: 'busy',
      };
      if (a.calendarEventId && a.calHash === hash) { skipped++; continue; }
      if (a.calendarEventId) {
        const r = lark(['calendar', 'events', 'patch', '--as', 'user', '--calendar-id', 'primary', '--event-id', a.calendarEventId, '--data', JSON.stringify(data)]);
        if (r.ok) { a.calHash = hash; updated++; log('✏️ 更新日程：' + data.summary); }
        else { failed++; log('❌ 更新日程失败：' + data.summary + ' — ' + (r.err || r.raw).slice(0, 200)); }
      } else {
        const r = lark(['calendar', 'events', 'create', '--as', 'user', '--calendar-id', 'primary', '--data', JSON.stringify(data)]);
        const evId = r.json?.data?.event?.event_id || null;
        if (r.ok && evId) { a.calendarEventId = evId; a.calHash = hash; created++; log('📅 创建日程：' + data.summary); }
        else { failed++; log('❌ 创建日程失败：' + data.summary + ' — ' + (r.err || r.raw).slice(0, 200)); }
      }
    }
  }
  writeState(s);
  log('📅 飞书日历：新增 ' + created + '，更新 ' + updated + '，跳过 ' + skipped + '，失败 ' + failed);
}
