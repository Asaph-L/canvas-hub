import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadConfig, log } from './util.mjs';
import { lark } from './larkrun.mjs';
import { matchComponent } from './syllabus.mjs';

function readState() {
  const p = path.join(ROOT, 'data', 'state.json');
  if (!fs.existsSync(p)) return { courses: {} };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeState(s) {
  fs.writeFileSync(path.join(ROOT, 'data', 'state.json'), JSON.stringify(s, null, 2));
}
function fmtDT(iso) {
  if (!iso) return null;
  try { return new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Hong_Kong', hour12: false }).replace('T', ' '); }
  catch { return null; }
}
const SRC_LABEL = { canvas: 'Canvas 文件', assignment: '作业附件', existing: '本地已有' };

export async function syncBase() {
  const cfg = loadConfig();
  if (cfg.channels?.larkBase === false) { log('⏭️ Base 同步已关闭（config.channels.larkBase）'); return; }
  const ljPath = path.join(ROOT, 'data', 'lark.json');
  if (!fs.existsSync(ljPath)) { log('❌ 未找到 data/lark.json（Base 尚未创建）'); return; }
  const lj = JSON.parse(fs.readFileSync(ljPath, 'utf8'));
  const BT = lj.baseToken;
  const T = lj.tables || {};
  if (!BT || !T['课程']) { log('❌ data/lark.json 配置不完整'); return; }
  const s = readState();

  const upd = (tableId, recordId, fields) => {
    const args = ['base', '+record-upsert', '--as', 'user', '--base-token', BT, '--table-id', tableId];
    if (recordId) args.push('--record-id', recordId);
    args.push('--json', JSON.stringify(fields));
    const r = lark(args);
    if (!r.ok) { log('❌ Base 写入失败（' + tableId + '）：' + (r.err || r.raw).slice(0, 200)); return recordId; }
    let rl = r.json?.data?.record?.record_id_list;
    if (typeof rl === 'string') { try { rl = JSON.parse(rl); } catch { rl = null; } }
    const newId = (Array.isArray(rl) ? rl[0] : null) || r.json?.data?.record?.record_id || r.json?.data?.record_id || r.json?.data?.id || null;
    if (!newId && !recordId) log('⚠️ 未能解析 record_id：' + r.raw.slice(0, 300));
    return newId || recordId;
  };

  let n = 0;
  for (const c of Object.values(s.courses)) {
    const submitted = (c.assignments || []).filter((a) => a.submission?.submitted_at).length;
    c.baseRecordId = upd(T['课程'], c.baseRecordId, {
      '课程编号': c.code,
      '课程名称': c.folder,
      'Canvas 全名': c.name,
      '文件数': Object.keys(c.files || {}).length,
      '作业数': (c.assignments || []).length,
      '已提交': submitted,
      '公告数': Object.keys(c.announcements || {}).length,
      ...(c.grades?.current_score != null ? { '当前分数': c.grades.current_score } : {}),
      ...(c.grades?.current_grade ? { '等级': c.grades.current_grade } : {}),
      ...(c.assessment?.components?.length ? { '评分组成': c.assessment.components.map((x) => x.name + ' ' + x.weight + '%').join('、') } : {}),
      '更新于': fmtDT(s.syncedAt),
    });
    n++;
  }
  for (const c of Object.values(s.courses)) {
    for (const a of c.assignments || []) {
      const comp = matchComponent(c, a.name);
      a.baseRecordId = upd(T['作业'], a.baseRecordId, {
        '作业名': a.name,
        '课程': c.folder,
        'Canvas ID': a.id,
        ...(a.due_at ? { '截止时间': fmtDT(a.due_at) } : {}),
        ...(a.points != null ? { '分值': a.points } : {}),
        '状态': a.submission?.submitted_at ? '已提交' : a.due_at ? '未提交' : '无截止',
        ...(comp ? { '权重': comp.weight } : {}),
        ...(a.url ? { 'Canvas 链接': a.url } : {}),
        ...(a.calendarEventId ? { '飞书日程': a.calendarEventId } : {}),
      });
      n++;
    }
    for (const [key, f] of Object.entries(c.files || {})) {
      f.baseRecordId = upd(T['文件'], f.baseRecordId, {
        '文件名': f.name,
        '课程': c.folder,
        '分类': f.category || '其他',
        ...(f.week != null ? { '周次': f.week } : {}),
        '本地路径': f.path,
        '大小(KB)': f.size != null ? Math.round(f.size / 1024) : 0,
        '来源': SRC_LABEL[f.source] || String(f.source || ''),
        ...(f.updated_at ? { '更新时间': fmtDT(f.updated_at) } : {}),
      });
      n++;
    }
    for (const a of Object.values(c.announcements || {})) {
      a.baseRecordId = upd(T['公告'], a.baseRecordId, {
        '标题': a.title,
        '课程': c.folder,
        ...(a.posted_at ? { '发布时间': fmtDT(a.posted_at) } : {}),
        ...(a.firstSeen ? { '首次收录': fmtDT(a.firstSeen) } : {}),
      });
      n++;
    }
  }
  writeState(s);
  log('🗂️ Base 同步完成：处理 ' + n + ' 条记录');
}
