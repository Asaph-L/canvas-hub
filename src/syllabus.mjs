import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, loadConfig, log } from './util.mjs';

function readState() {
  const p = path.join(ROOT, 'data', 'state.json');
  if (!fs.existsSync(p)) return { courses: {} };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeState(s) {
  fs.writeFileSync(path.join(ROOT, 'data', 'state.json'), JSON.stringify(s, null, 2));
}
const iso = () => new Date().toISOString();

function decodeUni(s) {
  return String(s).replace(/\\U([0-9a-fA-F]{4})/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); });
}

function pdfText(file) {
  try {
    const r = spawnSync('mdimport', ['-t', '-d3', file], { encoding: 'utf8', timeout: 30000 });
    const out = r.stdout || '';
    const marker = 'kMDItemTextContent = "';
    const i = out.indexOf(marker);
    if (i >= 0) {
      const rest = out.slice(i + marker.length);
      const m = rest.search(/";\s*\n?\s*(kMDItem|\})/);
      const txt = decodeUni(m >= 0 ? rest.slice(0, m) : rest);
      if (txt.trim().length > 100) return txt;
    }
    const r2 = spawnSync('mdls', ['-name', 'kMDItemTextContent', '-raw', file], { encoding: 'utf8', timeout: 15000 });
    const t2 = (r2.stdout || '').trim();
    if (r2.status === 0 && t2 && t2 !== '(null)' && t2.length > 100) return t2;
  } catch {}
  return null;
}

function htmlText(file) {
  try {
    const html = fs.readFileSync(file, 'utf8');
    const t = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
    return t.length > 100 ? t : null;
  } catch { return null; }
}

function findSyllabus(c) {
  const cfg = loadConfig();
  const root = path.resolve(ROOT, cfg.download?.root || '..');
  const dir = path.join(root, c.folder);
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { return null; }
  const cands = entries.filter((e) => /syllabus/i.test(e) && /\.(pdf|html?)$/i.test(e));
  for (const e of cands) {
    const p = path.join(dir, e);
    const text = /\.pdf$/i.test(e) ? pdfText(p) : htmlText(p);
    if (text) return { text, source: e };
  }
  return null;
}

const GROUPS = [
  [/final|期末/i, '期末考试', 'exam'],
  [/midterm|mid-term|期中/i, '期中考试', 'exam'],
  [/quiz|小测|test/i, '测验', 'quiz'],
  [/project|report|项目|报告/i, '项目', 'project'],
  [/presentation|演示/i, '演示', 'project'],
  [/assignment|homework|coursework|作业|course work/i, '作业', 'assignment'],
  [/lab|实验/i, '实验', 'assignment'],
  [/participation|attendance|出席|参与|课堂/i, '参与', 'participation'],
  [/exam|考试/i, '考试', 'exam'],
];

function heuristicExtract(text) {
  const groups = new Map();
  const lines = text.split(/\n+/);
  for (const line of lines) {
    if (line.length > 400) continue;
    const pm = line.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
    if (!pm) continue;
    const pct = parseFloat(pm[1]);
    if (!(pct > 0 && pct <= 100)) continue;
    for (const [re, name, type] of GROUPS) {
      if (re.test(line)) {
        const g = groups.get(name) || { name, type, weight: 0 };
        g.weight += pct;
        groups.set(name, g);
        break;
      }
    }
  }
  const comps = [...groups.values()].map((g) => ({ name: g.name, type: g.type, weight: Math.round(g.weight * 10) / 10 }));
  const total = comps.reduce((n, x) => n + x.weight, 0);
  if (total > 0 && total <= 100) return comps;
  if (total > 100 && total <= 115) {
    const scale = 100 / total;
    return comps.map((x) => ({ ...x, weight: Math.round(x.weight * scale * 10) / 10 }));
  }
  return [];
}

function settingsJson() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'settings.json'), 'utf8')) || {}; } catch { return {}; }
}

async function llmExtract(text, key, model) {
  const prompt = '以下是课程大纲（syllabus）文本。请提取该课程的评分组成（assessment components）。\n规则：\n1. 每个评分项的 name 用简洁中文（如"作业""期中考试""期末考试""项目"），type 取值 exam/quiz/assignment/project/participation/other。\n2. weight 为该评分项占总分的百分比（数字，不含 % 号），全部评分项权重之和应为 100。\n3. 若大纲提到及格线（passing threshold）写入 passThreshold（数字或 null）。\n4. 只输出 JSON，不要输出其他内容。\n\n输出格式：\n{"components":[{"name":"作业","type":"assignment","weight":30},{"name":"期末考试","type":"exam","weight":50}],"passThreshold":null,"notes":""}\n\n大纲文本：\n' + text.slice(0, 12000);
  const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: model || 'deepseek-chat', messages: [{ role: 'user', content: prompt }], temperature: 0, response_format: { type: 'json_object' } }),
    signal: AbortSignal.timeout(120000),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '';
  try {
    const j = JSON.parse(content);
    const comps = (Array.isArray(j.components) ? j.components : []).map((x) => ({ name: String(x.name || '未命名'), type: String(x.type || 'other'), weight: Number(x.weight) || 0 })).filter((x) => x.weight > 0 && x.weight <= 100);
    if (!comps.length) return null;
    return { components: comps, passThreshold: j.passThreshold ?? null, notes: String(j.notes || '') };
  } catch { return null; }
}

export const COMPONENT_RES = {
  exam: /exam|final|midterm|考试|期末|期中/i,
  quiz: /quiz|小测|test/i,
  project: /project|report|present|项目|报告|演示/i,
  assignment: /assignment|homework|作业|lab|实验|coursework/i,
  participation: /participation|attend|参与|出席/i,
};

export function computeSafety(c, target = 60) {
  const comps = ((c.assessment && c.assessment.components) || []).filter((x) => x.weight > 0);
  if (!comps.length) return null;
  let earned = 0, gradedW = 0;
  for (const comp of comps) {
    const re = COMPONENT_RES[comp.type] || /./;
    const as = (c.assignments || []).filter((a) => re.test(a.name || ''));
    let pts = 0, score = 0;
    for (const a of as) {
      if (a.points != null && a.submission && a.submission.score != null) { pts += a.points; score += a.submission.score; }
    }
    comp.earnedPct = pts > 0 ? Math.round(score / pts * 1000) / 10 : null;
    if (comp.earnedPct != null) { earned += comp.earnedPct / 100 * comp.weight; gradedW += comp.weight; }
  }
  const remainingW = Math.max(0, 100 - gradedW);
  const currentNorm = gradedW > 0 ? earned / gradedW * 100 : null;
  for (const comp of comps) {
    if (comp.earnedPct != null || comp.weight <= 0) continue;
    comp.reqIfOthersFull = Math.max(0, Math.round((target - earned) / comp.weight * 1000) / 10);
    if (currentNorm != null) {
      const others = Math.max(0, remainingW - comp.weight);
      comp.reqIfOthersAvg = Math.max(0, Math.round((target - earned - others * currentNorm / 100) / comp.weight * 1000) / 10);
    }
  }
  return { earned: Math.round(earned * 100) / 100, gradedW: Math.round(gradedW * 100) / 100, remainingW: Math.round(remainingW * 100) / 100, currentNorm: currentNorm != null ? Math.round(currentNorm * 10) / 10 : null, target };
}

const MATCH_ORDER = ['quiz', 'project', 'assignment', 'participation', 'exam'];

export function matchComponent(c, name) {
  const comps = (c.assessment && c.assessment.components) || [];
  const target = String(name || '');
  for (const type of MATCH_ORDER) {
    for (const comp of comps) {
      if (comp.type !== type) continue;
      const re = COMPONENT_RES[type];
      if (re && re.test(target)) return comp;
    }
  }
  for (const comp of comps) {
    const re = COMPONENT_RES[comp.type];
    if (re && re.test(target)) return comp;
  }
  return null;
}

export async function analyzeSyllabi({ force = false } = {}) {
  const cfg = loadConfig();
  const target = cfg.grades?.targetPercent ?? 60;
  const s = readState();
  const settings = settingsJson();
  let done = 0, skipped = 0;
  for (const c of Object.values(s.courses)) {
    if (!force && c.assessment?.components?.length) { skipped++; continue; }
    const found = findSyllabus(c);
    if (!found) { log('⚠️ ' + c.folder + '：找不到 syllabus 文件，跳过'); continue; }
    log('📄 ' + c.folder + '：解析 ' + found.source + '（' + found.text.length + ' 字）');
    let result = null;
    if (settings.deepseekApiKey) {
      result = await llmExtract(found.text, settings.deepseekApiKey, settings.model);
      if (result) log('   🤖 DeepSeek 解析成功');
    }
    if (!result || !result.components.length) {
      result = { components: heuristicExtract(found.text), passThreshold: null, notes: '' };
      if (result.components.length) log('   🔍 启发式解析成功');
    }
    if (!result.components.length) {
      log('   ⚠️ 未识别出评分组成（可在网页设置里填 DeepSeek Key 后用 node cli.mjs analyze --force 重试）');
      continue;
    }
    c.assessment = { components: result.components, passThreshold: result.passThreshold, notes: result.notes, source: found.source + (settings.deepseekApiKey ? ' + DeepSeek' : ' + 启发式'), updatedAt: iso() };
    c.safety = computeSafety(c, target);
    done++;
    log('   ✅ ' + result.components.map((x) => x.name + ' ' + x.weight + '%').join('、'));
  }
  for (const c of Object.values(s.courses)) {
    if (c.assessment?.components?.length) c.safety = computeSafety(c, target);
  }
  writeState(s);
  log('📊 大纲解析完成：新解析 ' + done + ' 门，沿用 ' + skipped + ' 门');
}

export function updateAssessment(folder, components) {
  const s = readState();
  const course = Object.values(s.courses).find((c) => c.folder === folder || c.folder.startsWith(folder));
  if (!course) return '没有找到课程：' + folder;
  const clean = (Array.isArray(components) ? components : []).map((x) => ({ name: String(x.name || '未命名'), type: String(x.type || 'other'), weight: Number(x.weight) || 0 })).filter((x) => x.weight > 0);
  if (!clean.length) return '评分组成不能为空';
  const cfg = loadConfig();
  course.assessment = { components: clean, passThreshold: course.assessment?.passThreshold ?? null, source: 'manual', updatedAt: iso() };
  course.safety = computeSafety(course, cfg.grades?.targetPercent ?? 60);
  writeState(s);
  return '已更新「' + course.folder + '」的评分组成：' + clean.map((x) => x.name + ' ' + x.weight + '%').join('、');
}
