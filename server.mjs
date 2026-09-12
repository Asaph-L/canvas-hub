import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, hkTime } from './src/util.mjs';
import { updateAssessment, matchComponent } from './src/syllabus.mjs';

const PORT = Number(process.env.CANVAS_HUB_PORT || (readJSON(path.join(ROOT, 'config.json')) || {}).web?.port || 8788);
const HOST = '127.0.0.1';
const WEB_DIR = path.join(ROOT, 'out', 'web');
const DATA_DIR = path.join(ROOT, 'data');
const SECRETS_PATH = path.join(ROOT, 'secrets.json');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const LOGS_DIR = path.join(ROOT, 'logs');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.pdf': 'application/pdf', '.md': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.zip': 'application/zip' };

const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

function loadSettings() {
  const s = readJSON(SETTINGS_PATH) || {};
  const sec = readJSON(SECRETS_PATH) || {};
  return { deepseekApiKey: s.deepseekApiKey || '', model: s.model || 'deepseek-chat', canvasTokenSet: !!sec.canvasToken, baseUrl: (readJSON(path.join(DATA_DIR, 'lark.json')) || {}).baseUrl || null };
}

function saveSettings({ deepseekApiKey, model, canvasToken }) {
  const s = readJSON(SETTINGS_PATH) || {};
  if (typeof deepseekApiKey === 'string' && deepseekApiKey.trim()) s.deepseekApiKey = deepseekApiKey.trim();
  if (typeof model === 'string' && model.trim()) s.model = model.trim();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2));
  try { fs.chmodSync(SETTINGS_PATH, 0o600); } catch {}
  if (typeof canvasToken === 'string' && canvasToken.trim()) {
    const sec = readJSON(SECRETS_PATH) || {};
    sec.canvasToken = canvasToken.trim();
    fs.writeFileSync(SECRETS_PATH, JSON.stringify(sec, null, 2));
    try { fs.chmodSync(SECRETS_PATH, 0o600); } catch {}
  }
}

const ALLOWED = ['sync', 'daily', 'evening', 'digest', 'dashboard', 'calendar', 'base', 'status', 'due'];
function runCmd(command) {
  return new Promise((resolve) => {
    const args = ['cli.mjs', ...(command === 'due' ? ['due', '10'] : [command])];
    const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' } });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 900000);
    child.on('close', (code) => {
      clearTimeout(timer);
      const full = (out + (err ? '\n[stderr]\n' + err : '')).trim();
      resolve({ code, tail: full.slice(-6000) });
    });
  });
}

function buildStatePayload() {
  const st = readJSON(path.join(DATA_DIR, 'state.json')) || { courses: {} };
  const lj = readJSON(path.join(DATA_DIR, 'lark.json')) || {};
  const now = Date.now();
  const DAY = 86400000;
  const courses = Object.values(st.courses).map((c) => {
    const files = Object.values(c.files || {}).map((f) => ({ name: f.name, path: f.path, category: f.category || '其他', size: f.size, week: f.week, source: f.source, updatedAt: f.updated_at, downloadedAt: f.downloadedAt }));
    const byCat = {};
    for (const f of files) byCat[f.category] = (byCat[f.category] || 0) + 1;
    const assignments = (c.assignments || []).map((a) => ({ ...a, course: c.folder, dueLabel: a.due_at ? hkTime(a.due_at) : null }));
    const announcements = Object.values(c.announcements || {}).sort((a, b) => String(b.posted_at).localeCompare(String(a.posted_at))).slice(0, 8);
    return { code: c.code, folder: c.folder, fullName: c.name, files, byCat, assignments, announcements, grades: c.grades || null, assessment: c.assessment || null, safety: c.safety || null };
  });
  const dues = [];
  for (const a of courses.flatMap((c) => c.assignments)) {
    if (!a.due_at) continue;
    const days = (new Date(a.due_at).getTime() - now) / DAY;
    if (days >= -1 && days <= 10) dues.push({ ...a, days });
  }
  dues.sort((a, b) => a.due_at.localeCompare(b.due_at));
  const pendingList = [];
  for (const a of courses.flatMap((c) => c.assignments)) {
    if (!a.due_at) continue;
    if (a.submission && a.submission.submitted_at) continue;
    const days = (new Date(a.due_at).getTime() - now) / DAY;
    if (days >= -0.1) pendingList.push({ ...a, days });
  }
  pendingList.sort((a, b) => a.due_at.localeCompare(b.due_at));
  const newFiles = [];
  for (const c of courses) {
    for (const f of c.files) {
      if (f.downloadedAt && now - new Date(f.downloadedAt).getTime() < 7 * DAY) newFiles.push({ ...f, course: c.folder });
    }
  }
  newFiles.sort((a, b) => String(b.downloadedAt).localeCompare(String(a.downloadedAt)));
  const totalFiles = courses.reduce((n, c) => n + c.files.length, 0);
  const cfgFile = readJSON(path.join(ROOT, 'config.json')) || {};
  const nextActions = [];
  for (const c of courses) {
    for (const a of c.assignments) {
      if (!a.due_at) continue;
      if (a.submission && a.submission.submitted_at) continue;
      const days = (new Date(a.due_at).getTime() - now) / DAY;
      if (days < -1) continue;
      const comp = matchComponent(c, a.name);
      const weight = comp ? comp.weight : null;
      const urgency = 7 / (Math.max(days, 0.05) + 7);
      const w = weight != null ? weight : (a.points != null ? Math.min(20, a.points) : 5);
      nextActions.push({ course: c.folder, name: a.name, due_at: a.due_at, dueLabel: a.dueLabel, days, weight: comp ? comp.name + ' ' + comp.weight + '%' : null, points: a.points, score: Math.round(w * urgency * 100) / 100 });
    }
  }
  nextActions.sort((a, b) => b.score - a.score);
  return { syncedAt: st.syncedAt, baseUrl: lj.baseUrl || null, lang: (cfgFile.web && cfgFile.web.lang) || 'zh', demo: !!st.demo, courses, dues, pendingList, newFiles, nextActions: nextActions.slice(0, 8), totalFiles };
}

function latestSyncLogTail() {
  try {
    const files = fs.readdirSync(LOGS_DIR).filter((f) => f.startsWith('sync-') && f.endsWith('.log')).sort();
    const latest = files[files.length - 1];
    if (!latest) return '';
    const lines = fs.readFileSync(path.join(LOGS_DIR, latest), 'utf8').split('\n').filter(Boolean);
    return lines.slice(-60).join('\n');
  } catch { return ''; }
}

// ---------- DeepSeek mini-agent ----------
const TOOLS = [
  { type: 'function', function: { name: 'run_sync', description: '同步 Canvas 最新数据：下载新文件、更新作业/公告（用户要求"更新/同步/刷新"时调用）', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'run_daily', description: '完整更新：同步+摘要+仪表盘+飞书日历+Base+推送（用户要求"完整更新"时调用）', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'run_due', description: '查询近期截止的作业列表', parameters: { type: 'object', properties: { days: { type: 'number', description: '未来天数，默认 10' } } } } },
  { type: 'function', function: { name: 'get_grades', description: '查询各课程当前成绩、大纲评分组成与安全线分析（某场考试需要多少分才安全）', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'set_assessment', description: '手动设置/修改某门课的评分组成（名称/类型/权重百分比）', parameters: { type: 'object', properties: { course: { type: 'string', description: '课程文件夹名，如 5003 data storing' }, components: { type: 'array', description: '评分项数组', items: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' }, weight: { type: 'number' } } } } } } } },
  { type: 'function', function: { name: 'get_status', description: '获取当前课程、文件、作业、公告的统计概览', parameters: { type: 'object', properties: {} } } },
];

async function execTool(name, args) {
  if (name === 'run_sync') { const r = await runCmd('sync'); return r.code === 0 ? '同步完成。\n' + r.tail : '同步失败：\n' + r.tail; }
  if (name === 'run_daily') { const r = await runCmd('daily'); return r.code === 0 ? '完整更新完成。\n' + r.tail : '完整更新失败：\n' + r.tail; }
  if (name === 'run_due') { const r = await runCmd('due'); return r.tail || '（没有近期截止）'; }
  if (name === 'get_grades') return gradesText();
  if (name === 'set_assessment') return updateAssessment(String(args.course || ''), args.components || []);
  if (name === 'get_status') {
    const p = buildStatePayload();
    const lines = ['当前共 ' + p.courses.length + ' 门课，' + p.totalFiles + ' 个文件，最近同步于 ' + (p.syncedAt || '未知') + '。'];
    for (const c of p.courses) lines.push('- ' + c.folder + '：文件 ' + c.files.length + ' 个，作业 ' + c.assignments.length + ' 个，公告 ' + c.announcements.length + ' 条');
    return lines.join('\n');
  }
  return '未知工具';
}

function gradesText() {
  const p = buildStatePayload();
  const lines = [];
  for (const c of p.courses) {
    const g = c.grades;
    let line = '- ' + c.folder;
    if (g && g.current_score != null) line += '：当前 ' + g.current_score + '%' + (g.current_grade ? '（' + g.current_grade + '）' : '');
    else line += '：暂无成绩';
    lines.push(line);
    for (const comp of c.assessment?.components || []) {
      let s = '    · ' + comp.name + ' 占 ' + comp.weight + '%';
      if (comp.earnedPct != null) s += '，已得 ' + comp.earnedPct + '%';
      else if (comp.reqIfOthersAvg != null) s += '，按当前水平需 ≥' + comp.reqIfOthersAvg + '% 可保总分 ' + (c.safety?.target ?? 60);
      else if (comp.reqIfOthersFull != null) s += '，若其余满分需 ≥' + comp.reqIfOthersFull + '%';
      else s += '，待考';
      lines.push(s);
    }
  }
  return lines.join('\n') || '暂无数据';
}

function systemPrompt(langOverride) {
  const p = buildStatePayload();
  const lines = [];
  lines.push('你是「Canvas 课程管家」的智能助手，运行在用户的本地电脑上，负责帮用户管理 CityU Canvas 课程资料。');
  lines.push('');
  lines.push('当前实时数据摘要：');
  lines.push('- 课程（' + p.courses.length + ' 门）：' + p.courses.map((c) => c.folder).join('、'));
  lines.push('- 文件总数：' + p.totalFiles + '，最近同步：' + (p.syncedAt || '未知'));
  lines.push('- 统计口径（回答数量类问题时必须原样使用这两个数字，不得估算或改写）：课程 ' + p.courses.length + ' 门、文件 ' + p.totalFiles + ' 个');
  if (p.dues.length) lines.push('- 未来 10 天截止：' + p.dues.map((d) => '[' + d.course + '] ' + d.name + '（' + d.dueLabel + (d.submission?.submitted_at ? '，已提交' : '，未提交') + '）').join('；'));
  else lines.push('- 未来 10 天没有截止作业');
  const gradeLines = p.courses.map((c) => (c.grades?.current_score != null ? c.folder + ' 当前 ' + c.grades.current_score + '%' + (c.grades.current_grade ? '（' + c.grades.current_grade + '）' : '') : null)).filter(Boolean);
  if (gradeLines.length) lines.push('- 成绩：' + gradeLines.join('；'));
  const safetyLines = [];
  for (const c of p.courses) {
    for (const comp of c.assessment?.components || []) {
      if (comp.reqIfOthersAvg != null) safetyLines.push(c.folder + ' 的 ' + comp.name + '（占 ' + comp.weight + '%）按当前水平需 ≥' + comp.reqIfOthersAvg + '% 才能保总分 ' + (c.safety?.target ?? 60));
    }
  }
  if (safetyLines.length) lines.push('- 安全线：' + safetyLines.join('；'));
  const actionLines = (p.nextActions || []).slice(0, 4).map((a) => a.course + '：' + a.name + '（' + a.dueLabel + (a.weight ? '，权重 ' + a.weight : '') + '）');
  if (actionLines.length) lines.push('- 行动建议（按紧急度×权重排序）：' + actionLines.join('；'));
  lines.push('');
  const cfgWeb = (readJSON(path.join(ROOT, 'config.json')) || {}).web || {};
  const uiLang = langOverride || cfgWeb.lang || 'zh';
  if (uiLang === 'en') lines.push('- Language: the user interface is in English; always reply in English.');
  lines.push('规则：回答简短、用中文；涉及课程数据时以摘要为准，不要编造；用户要求更新/同步时调用 run_sync（强调完整流程则 run_daily）；要查截止调用 run_due 或直接回答；询问成绩、评分组成或"某考试要多少分"时调用 get_grades；用户要修改评分组成权重时调用 set_assessment；更新完成后用结果简要汇报。');
  return lines.join('\n');
}

const sessions = new Map();
async function deepseekChat(sessionId, message) {
  const settings = loadSettings();
  const key = settings.deepseekApiKey;
  if (!key) return '⚠️ 还没配置 DeepSeek API Key。请到「设置」页填入（在 platform.deepseek.com 的 API Keys 里创建），保存后就可以和我对话了。';
  let hist = sessions.get(sessionId) || [];
  const msgs = [{ role: 'system', content: systemPrompt() }, ...hist, { role: 'user', content: message }];
  for (let round = 0; round < 4; round++) {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: settings.model, messages: msgs, tools: TOOLS, temperature: 0.3 }),
      signal: AbortSignal.timeout(120000),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      if (resp.status === 401) return '⚠️ DeepSeek API Key 无效（401），请到「设置」页检查。';
      return '⚠️ DeepSeek 接口出错（HTTP ' + resp.status + '）：' + body.slice(0, 200);
    }
    const data = await resp.json();
    const msg = data.choices?.[0]?.message;
    if (!msg) return '⚠️ DeepSeek 返回为空。';
    if (msg.tool_calls?.length) {
      msgs.push(msg);
      for (const tc of msg.tool_calls) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
        const result = await execTool(tc.function.name, args);
        msgs.push({ role: 'tool', tool_call_id: tc.id, content: String(result).slice(0, 6000) });
      }
      continue;
    }
    hist = [...hist, { role: 'user', content: message }, { role: 'assistant', content: msg.content || '' }];
    if (hist.length > 16) hist = hist.slice(-16);
    sessions.set(sessionId, hist);
    return msg.content || '（空回复）';
  }
  return '⚠️ 工具调用轮次超限，请再试一次。';
}

async function deepseekChatStream(sessionId, message, send, lang) {
  const settings = loadSettings();
  const key = settings.deepseekApiKey;
  if (!key) { send({ type: 'delta', text: '⚠️ 还没配置 DeepSeek API Key。请到「设置」页填入，保存后就可以和我对话了。' }); send({ type: 'done' }); return; }
  let hist = sessions.get(sessionId) || [];
  const msgs = [{ role: 'system', content: systemPrompt(lang) }, ...hist, { role: 'user', content: message }];
  for (let round = 0; round < 4; round++) {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: settings.model, messages: msgs, tools: TOOLS, temperature: 0.3, stream: true }),
      signal: AbortSignal.timeout(300000),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      send({ type: 'delta', text: resp.status === 401 ? '⚠️ DeepSeek API Key 无效（401），请到「设置」页检查。' : '⚠️ DeepSeek 接口出错（HTTP ' + resp.status + '）：' + body.slice(0, 200) });
      send({ type: 'done' });
      return;
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let content = '';
    const toolCalls = [];
    while (true) {
      const chunkRead = await reader.read();
      if (chunkRead.done) break;
      buf += decoder.decode(chunkRead.value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let chunk = null;
        try { chunk = JSON.parse(payload); } catch { continue; }
        const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
        if (!delta) continue;
        if (delta.content) { content += delta.content; send({ type: 'delta', text: delta.content }); }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const i = tc.index != null ? tc.index : 0;
            if (!toolCalls[i]) toolCalls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } };
            const slot = toolCalls[i];
            if (tc.id) slot.id = tc.id;
            if (tc.function && tc.function.name) slot.function.name += tc.function.name;
            if (tc.function && tc.function.arguments) slot.function.arguments += tc.function.arguments;
          }
        }
      }
    }
    const calls = toolCalls.filter(Boolean);
    if (calls.length) {
      msgs.push({ role: 'assistant', content: content || null, tool_calls: calls });
      for (const tc of calls) {
        const label = tc.function.name === 'run_sync' ? '正在同步 Canvas…' : tc.function.name === 'run_daily' ? '正在执行完整更新（约 2 分钟）…' : tc.function.name === 'run_due' ? '正在查询截止…' : tc.function.name === 'get_grades' ? '正在读取成绩与安全线…' : tc.function.name === 'set_assessment' ? '正在更新评分组成…' : '正在查询数据…';
        send({ type: 'status', text: label });
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
        const result = await execTool(tc.function.name, args);
        msgs.push({ role: 'tool', tool_call_id: tc.id, content: String(result).slice(0, 6000) });
      }
      send({ type: 'status', text: '整理结果…' });
      continue;
    }
    hist = [...hist, { role: 'user', content: message }, { role: 'assistant', content }];
    if (hist.length > 16) hist = hist.slice(-16);
    sessions.set(sessionId, hist);
    send({ type: 'done' });
    return;
  }
  send({ type: 'delta', text: '⚠️ 工具调用轮次超限，请再试一次。' });
  send({ type: 'done' });
}

// ---------- HTTP server ----------
function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (d) => { b += d; if (b.length > 1024 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = decodeURIComponent(u.pathname);
  try {
    if (p === '/api/state') return sendJSON(res, 200, buildStatePayload());
    if (p === '/api/status') return sendJSON(res, 200, { ok: true, text: latestSyncLogTail() });
    if (p === '/api/settings' && req.method === 'GET') {
      const s = loadSettings();
      return sendJSON(res, 200, { deepseekKeySet: !!s.deepseekApiKey, canvasTokenSet: s.canvasTokenSet, model: s.model, baseUrl: s.baseUrl });
    }
    if (p === '/api/settings' && req.method === 'POST') {
      const b = await readBody(req);
      saveSettings(b);
      const s = loadSettings();
      return sendJSON(res, 200, { ok: true, deepseekKeySet: !!s.deepseekApiKey, canvasTokenSet: s.canvasTokenSet, model: s.model });
    }
    if (p === '/api/run' && req.method === 'POST') {
      const b = await readBody(req);
      const cmd = String(b.command || '');
      if (!ALLOWED.includes(cmd)) return sendJSON(res, 400, { ok: false, error: '不允许的命令：' + cmd });
      const r = await runCmd(cmd);
      return sendJSON(res, 200, { ok: r.code === 0, command: cmd, output: r.tail });
    }
    if (p === '/api/chat' && req.method === 'POST') {
      const b = await readBody(req);
      const reply = await deepseekChat(String(b.sessionId || 'default'), String(b.message || ''));
      return sendJSON(res, 200, { ok: true, reply });
    }
    if (p === '/api/chat/stream' && req.method === 'POST') {
      const b = await readBody(req);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      });
      const send = (obj) => { try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch {} };
      try {
        await deepseekChatStream(String(b.sessionId || 'default'), String(b.message || ''), send, String(b.lang || ''));
      } catch (e) {
        send({ type: 'delta', text: '⚠️ 出错：' + String((e && e.message) || e) });
        send({ type: 'done' });
      }
      return res.end();
    }
    if (p === '/api/logs') return sendJSON(res, 200, { ok: true, text: latestSyncLogTail() });
    if (p.startsWith('/files')) {
      const rel = u.searchParams.get('path') || '';
      const cfg = readJSON(path.join(ROOT, 'config.json')) || {};
      const root = path.resolve(ROOT, cfg.download?.root || '..');
      const abs = path.resolve(root, rel);
      if (!abs.startsWith(root + path.sep) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('not found');
      }
      const ext = path.extname(abs).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Disposition': 'inline; filename*=UTF-8\'\'' + encodeURIComponent(path.basename(abs)) });
      return fs.createReadStream(abs).pipe(res);
    }
    let file = p === '/' ? 'index.html' : p.slice(1);
    if (!file.includes('/') || file.startsWith('out/web/')) file = path.basename(file);
    const abs = path.join(WEB_DIR, file);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' });
      return fs.createReadStream(abs).pipe(res);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
  } catch (e) {
    sendJSON(res, 500, { ok: false, error: String(e.message || e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log('Canvas 课程管家 Web 已启动：http://' + HOST + ':' + PORT);
});
