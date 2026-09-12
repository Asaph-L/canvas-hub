import fs from 'node:fs';
import path from 'node:path';
import { ROOT, log } from './util.mjs';
import { lark } from './larkrun.mjs';

const TABLES = [
  {
    name: '课程',
    fields: [
      { name: '课程编号', type: 'text' }, { name: '课程名称', type: 'text' }, { name: 'Canvas 全名', type: 'text' },
      { name: '文件数', type: 'number' }, { name: '作业数', type: 'number' }, { name: '已提交', type: 'number' },
      { name: '公告数', type: 'number' }, { name: '当前分数', type: 'number' }, { name: '等级', type: 'text' },
      { name: '评分组成', type: 'text' }, { name: '更新于', type: 'datetime' },
    ],
  },
  {
    name: '作业',
    fields: [
      { name: '作业名', type: 'text' }, { name: '课程', type: 'text' }, { name: 'Canvas ID', type: 'number' },
      { name: '截止时间', type: 'datetime' }, { name: '分值', type: 'number' }, { name: '权重', type: 'number' },
      { name: '状态', type: 'select', options: [{ name: '已提交' }, { name: '未提交' }, { name: '无截止' }] },
      { name: 'Canvas 链接', type: 'text' }, { name: '飞书日程', type: 'text' },
    ],
  },
  {
    name: '文件',
    fields: [
      { name: '文件名', type: 'text' }, { name: '课程', type: 'text' },
      { name: '分类', type: 'select', options: [{ name: '讲义' }, { name: '作业' }, { name: '阅读' }, { name: '其他' }] },
      { name: '周次', type: 'number' }, { name: '本地路径', type: 'text' }, { name: '大小(KB)', type: 'number' },
      { name: '来源', type: 'text' }, { name: '更新时间', type: 'datetime' },
    ],
  },
  {
    name: '公告',
    fields: [
      { name: '标题', type: 'text' }, { name: '课程', type: 'text' },
      { name: '发布时间', type: 'datetime' }, { name: '首次收录', type: 'datetime' },
    ],
  },
];

function tableList(baseToken) {
  const r = lark(['base', '+table-list', '--as', 'user', '--base-token', baseToken, '--format', 'json']);
  return (r.json && r.json.data && r.json.data.tables) || [];
}

export async function larkInit({ dryRun = false } = {}) {
  const ljPath = path.join(ROOT, 'data', 'lark.json');
  if (fs.existsSync(ljPath)) {
    let lj = null;
    try { lj = JSON.parse(fs.readFileSync(ljPath, 'utf8')); } catch {}
    if (lj && lj.baseToken) {
      log('ℹ️ 已存在飞书 Base：' + (lj.baseUrl || lj.baseToken));
      log('   如需重建，请先删除 data/lark.json 再运行本命令。');
      return;
    }
  }
  if (dryRun) {
    log('（dry-run）将创建 Base「Canvas 课程中心」（时区 Asia/Hong_Kong）与 ' + TABLES.length + ' 张表：' + TABLES.map((t) => t.name).join(' / '));
    return;
  }
  const first = TABLES[0];
  const created = lark(['base', '+base-create', '--as', 'user', '--name', 'Canvas 课程中心', '--time-zone', 'Asia/Hong_Kong', '--table-name', first.name, '--fields', JSON.stringify(first.fields)]);
  const baseToken = created.json && created.json.data && created.json.data.base && created.json.data.base.base_token;
  const baseUrl = created.json && created.json.data && created.json.data.base && created.json.data.base.url;
  if (!created.ok || !baseToken) { log('❌ 创建 Base 失败：' + (created.err || created.raw).slice(0, 300)); return; }
  log('✅ 已创建 Base：' + (baseUrl || baseToken));
  const tables = {};
  const list0 = tableList(baseToken);
  const firstTable = list0.find((t) => t.name === first.name) || list0[0];
  if (firstTable) tables[first.name] = firstTable.id;
  for (const t of TABLES.slice(1)) {
    const r = lark(['base', '+table-create', '--as', 'user', '--base-token', baseToken, '--name', t.name, '--fields', JSON.stringify(t.fields)]);
    const found = tableList(baseToken).find((x) => x.name === t.name);
    if (found) { tables[t.name] = found.id; log('✅ 表「' + t.name + '」已就绪'); }
    else log('⚠️ 表「' + t.name + '」创建结果未知：' + (r.err || r.raw).slice(0, 200));
  }
  fs.mkdirSync(path.dirname(ljPath), { recursive: true });
  fs.writeFileSync(ljPath, JSON.stringify({ baseToken, baseUrl: baseUrl || '', tables }, null, 2));
  log('✅ 已写入 data/lark.json（Base token 与表 ID）');
  log('下一步：node cli.mjs base   # 把课程数据写进 Base');
}
