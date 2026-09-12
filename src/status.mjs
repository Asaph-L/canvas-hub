import fs from 'node:fs';
import path from 'node:path';
import { ROOT, log } from './util.mjs';

export function status() {
  const p = path.join(ROOT, 'data', 'state.json');
  if (!fs.existsSync(p)) { log('还没有同步记录，先运行: node cli.mjs sync'); return; }
  const s = JSON.parse(fs.readFileSync(p, 'utf8'));
  log('上次同步：' + s.syncedAt);
  for (const c of Object.values(s.courses)) {
    const byCat = {};
    for (const f of Object.values(c.files)) byCat[f.category] = (byCat[f.category] || 0) + 1;
    log('\n📁 ' + c.folder + '  [' + c.code + ']');
    log('   文件 ' + Object.keys(c.files).length + ' 个（' + Object.entries(byCat).map(([k, v]) => k + ' ' + v).join('，') + '） | 作业 ' + (c.assignments?.length || 0) + ' | 公告 ' + Object.keys(c.announcements || {}).length);
  }
}
