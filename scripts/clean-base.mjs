import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lj = JSON.parse(fs.readFileSync(new URL('../data/lark.json', import.meta.url), 'utf8'));
const BT = lj.baseToken;
const T = lj.tables;
const L = '/opt/homebrew/bin/lark-cli';

function run(args) {
  const r = spawnSync(L, args, { encoding: 'utf8', env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' } });
  const raw = (r.stdout || '').trim();
  const i = raw.indexOf('{');
  let j = null;
  try { j = JSON.parse(raw.slice(i)); } catch {}
  return { j, raw };
}

let totalDeleted = 0;
for (const [name, tid] of Object.entries(T)) {
  const lr = run(['base', '+record-list', '--as', 'user', '--base-token', BT, '--table-id', tid, '--format', 'json']);
  let ids = lr.j?.data?.record_id_list ?? [];
  if (typeof ids === 'string') { try { ids = JSON.parse(ids); } catch { ids = []; } }
  console.log(name + '：' + ids.length + ' 条，开始清理');
  for (const rid of ids) {
    const d = run(['base', '+record-delete', '--as', 'user', '--base-token', BT, '--table-id', tid, '--record-id', rid, '--yes']);
    if (!d.j?.ok) console.log('  ❌ 删除失败 ' + rid + '：' + d.raw.slice(0, 200));
    else totalDeleted++;
  }
  console.log(name + ' 清理完成');
}

const statePath = path.join(ROOT, 'data', 'state.json');
if (fs.existsSync(statePath)) {
  const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  for (const c of Object.values(s.courses)) {
    delete c.baseRecordId;
    for (const a of c.assignments || []) delete a.baseRecordId;
    for (const f of Object.values(c.files || {})) delete f.baseRecordId;
    for (const a of Object.values(c.announcements || {})) delete a.baseRecordId;
  }
  fs.writeFileSync(statePath, JSON.stringify(s, null, 2));
  console.log('已清空 state.json 中的 baseRecordId（重建时重新生成）');
}
console.log('共删除 ' + totalDeleted + ' 条记录');
