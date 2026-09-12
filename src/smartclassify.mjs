import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadConfig, log } from './util.mjs';

const CATS = ['讲义', '作业', '阅读', '其他'];

function readState() {
  const p = path.join(ROOT, 'data', 'state.json');
  if (!fs.existsSync(p)) return { courses: {} };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeState(s) { fs.writeFileSync(path.join(ROOT, 'data', 'state.json'), JSON.stringify(s, null, 2)); }
function settingsJson() { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'settings.json'), 'utf8')) || {}; } catch { return {}; } }

async function llmClassify(names, settings) {
  const prompt = '你是课程文件分类助手。请把下列文件名归类到四类：讲义（slides/lecture/课件/notes）、作业（assignment/homework/lab/quiz/project）、阅读（reading/paper/chapter/book）、其他。\n规则：只根据文件名判断，拿不准归"其他"；每个文件必须给出一个分类。\n只输出 JSON，格式：{"results":{"文件名":"分类"}}\n\n文件名列表：\n' + names.map((n, i) => (i + 1) + '. ' + n).join('\n');
  const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + settings.deepseekApiKey },
    body: JSON.stringify({ model: settings.model || 'deepseek-chat', messages: [{ role: 'user', content: prompt }], temperature: 0, response_format: { type: 'json_object' } }),
    signal: AbortSignal.timeout(120000),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '';
  try {
    const j = JSON.parse(content);
    const results = j.results || j;
    const map = {};
    for (const n of names) {
      const v = results[n];
      map[n] = CATS.includes(v) ? v : '其他';
    }
    return map;
  } catch { return null; }
}

export async function smartClassify({ scope = 'other' } = {}) {
  const cfg = loadConfig();
  const settings = settingsJson();
  if (!settings.deepseekApiKey) { log('⏭️ 智能分类跳过：未配置 DeepSeek Key（网页设置页可填）'); return; }
  const s = readState();
  const root = path.resolve(ROOT, cfg.download?.root || '..');
  let moved = 0, failed = 0, kept = 0;
  for (const c of Object.values(s.courses)) {
    const targets = Object.entries(c.files || {}).filter(([, f]) => !/syllabus/i.test(f.name) && (scope === 'all' || (f.category || '其他') === '其他'));
    if (!targets.length) continue;
    const names = targets.map(([, f]) => f.name);
    log('🤖 ' + c.folder + '：智能分类 ' + names.length + ' 个文件…');
    const map = await llmClassify(names, settings);
    if (!map) { log('   ❌ 分类请求失败'); failed += names.length; continue; }
    for (const [key, f] of targets) {
      const newCat = map[f.name] || f.category;
      if (!CATS.includes(newCat) || newCat === f.category) { kept++; continue; }
      const oldAbs = path.join(root, f.path);
      let newRel = path.posix.join(c.folder, newCat, f.name);
      let newAbs = path.join(root, newRel);
      if (fs.existsSync(newAbs)) {
        const ext = path.extname(newRel);
        newRel = newRel.slice(0, newRel.length - ext.length) + '-' + key + ext;
        newAbs = path.join(root, newRel);
      }
      try {
        fs.mkdirSync(path.dirname(newAbs), { recursive: true });
        fs.renameSync(oldAbs, newAbs);
        f.path = newRel;
        f.category = newCat;
        f.classifiedBy = 'deepseek';
        moved++;
        log('   📂 ' + f.name + ' → ' + newCat);
      } catch (e) { failed++; log('   ❌ ' + f.name + '：' + e.message); }
    }
  }
  writeState(s);
  log('🤖 智能分类完成：移动 ' + moved + ' 个，保持/跳过 ' + kept + ' 个，失败 ' + failed + ' 个');
}
