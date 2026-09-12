import fs from 'node:fs';
import path from 'node:path';
import { Canvas } from './canvas.mjs';
import { classifyFile, categoryOfPath } from './classify.mjs';
import { loadConfig, log, initLog, closeLog, sanitizeName, ensureDir, listDirs, deriveShortName, hkTime, ROOT } from './util.mjs';

const iso = () => new Date().toISOString();

function walk(absDir, relBase, map) {
  let entries;
  try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const rel = relBase ? relBase + '/' + e.name : e.name;
    if (e.isDirectory()) walk(path.join(absDir, e.name), rel, map);
    else map.set(e.name.toLowerCase(), rel);
  }
}

function cleanCode(code) {
  let s = String(code || '');
  s = s.replace(/^\d+/, '');
  s = s.replace(/^[A-Za-z]+/, '');
  return s || String(code || 'course');
}

function resolveFolder(root, code, name, cfg) {
  const fixed = (cfg.courses?.names || {})[code];
  if (fixed) return fixed;
  const dirs = listDirs(root);
  const tok = String(code || '').toLowerCase();
  const hit = dirs.find(d => {
    const lower = d.toLowerCase();
    if (lower === tok) return true;
    const t = (lower.split(/\s+/)[0] || '');
    return t.length >= 3 && (tok.endsWith(t) || t.endsWith(tok) || tok.includes(t) || t.includes(tok));
  });
  if (hit) return hit;
  const clean = cleanCode(code);
  return sanitizeName(clean + ' ' + deriveShortName(name, [code, clean]));
}

function dedupeRelPath(root, rel, week, fileId) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return rel;
  const ext = path.extname(rel);
  const base = rel.slice(0, rel.length - ext.length);
  const try1 = base + '-W' + (week || 'x') + ext;
  if (!fs.existsSync(path.join(root, try1))) return try1;
  const try2 = base + '-' + fileId + ext;
  if (!fs.existsSync(path.join(root, try2))) return try2;
  return base + '-' + Date.now() + ext;
}

async function syncCourse(canvas, c, cfg, ctx) {
  const { root, state, summary, dueSoon, maxSize, CATS } = ctx;
  const code = c.course_code || c.name;
  const prev = state.courses[String(c.id)] || {};
  const isNew = !prev.folder;
  const folderName = resolveFolder(root, code, c.name, cfg);
  const courseDir = path.join(root, folderName);
  ensureDir(courseDir);
  for (const k of CATS) ensureDir(path.join(courseDir, k));
  if (isNew) {
    summary.newCourses.push(folderName);
    log('\n🆕 新课程：已自动创建文件夹 ' + folderName + '/（讲义|作业|阅读|其他）');
  } else {
    log('\n📁 ' + folderName + ' (id=' + c.id + ')');
  }

  const existingIndex = new Map();
  walk(courseDir, '', existingIndex);

  const cs = {
    id: c.id, code, name: c.name, folder: folderName,
    files: { ...(prev.files || {}) }, folders: { ...(prev.folders || {}) },
    assignments: [], announcements: { ...(prev.announcements || {}) },
    baseRecordId: prev.baseRecordId,
    assessment: prev.assessment,
    safety: prev.safety,
    grades: prev.grades,
  };

  let folders = [];
  try {
    folders = await canvas.list('/courses/' + c.id + '/folders');
  } catch (e) {
    log('   ⚠️ 文件夹列表获取失败，继续按文件名分类：' + e.message);
  }
  for (const f of folders) {
    const rec = { name: f.name, fullName: f.full_name };
    const wm = /week\s*(\d+)/i.exec(f.full_name || '');
    if (wm) rec.week = parseInt(wm[1], 10);
    cs.folders[f.id] = rec;
  }

  const files = await canvas.list('/courses/' + c.id + '/files');
  let newCount = 0;
  for (const f of files) {
    const key = String(f.id);
    const prevF = cs.files[key];
    if (prevF && prevF.updated_at === f.updated_at && fs.existsSync(path.join(root, prevF.path))) continue;
    if (f.size > maxSize) { summary.large.push(folderName + '/' + (f.display_name || f.filename)); continue; }
    const name = sanitizeName(f.display_name || f.filename);
    const finfo = cs.folders[f.folder_id] || {};
    const week = finfo.week;
    const diskRel = existingIndex.get(name.toLowerCase());
    if (diskRel) {
      cs.files[key] = { ...(prevF?.baseRecordId ? { baseRecordId: prevF.baseRecordId } : {}), name, path: path.posix.join(folderName, diskRel), size: f.size, updated_at: f.updated_at, week, category: categoryOfPath(diskRel), source: 'existing', registeredAt: iso() };
      summary.existing.push(path.posix.join(folderName, diskRel));
      continue;
    }
    const category = classifyFile({ filename: name, folderFullName: finfo.fullName || '', source: 'file', config: cfg });
    let rel = path.join(folderName, category, name);
    rel = dedupeRelPath(root, rel, week, f.id);
    try {
      const fileUrl = f.url || (canvas.base + '/api/v1/files/' + f.id + '/download');
      await canvas.downloadTo(fileUrl, path.join(root, rel));
      cs.files[key] = { ...(prevF?.baseRecordId ? { baseRecordId: prevF.baseRecordId } : {}), name, path: rel, size: f.size, updated_at: f.updated_at, week, category, source: 'canvas', downloadedAt: iso() };
      summary.downloaded.push(rel);
      newCount++;
      log('   ⬇️ ' + rel);
    } catch (e) { summary.errors.push(rel + ': ' + e.message); log('   ❌ ' + rel + ': ' + e.message); }
  }

  const assignments = await canvas.list('/courses/' + c.id + '/assignments', { 'include[]': ['submission', 'all_dates'] });
  for (const a of assignments) {
    const due = a.due_at || (a.all_dates && a.all_dates[0]?.due_at) || null;
    const prevA = (prev.assignments || []).find((x) => x.id === a.id);
    const rec = {
      id: a.id, name: a.name, due_at: due, points: a.points_possible, url: a.html_url,
      submission: a.submission ? { submitted_at: a.submission.submitted_at, grade: a.submission.grade, score: a.submission.score, missing: !!a.submission.missing } : null,
      ...(prevA ? { calendarEventId: prevA.calendarEventId, calHash: prevA.calHash, baseRecordId: prevA.baseRecordId } : {}),
    };
    cs.assignments.push(rec);
    if (due) {
      const days = (new Date(due).getTime() - Date.now()) / 86400000;
      if (days >= -1 && days <= 7) dueSoon.push({ course: folderName, name: a.name, due_at: due, submitted: !!a.submission?.submitted_at, days });
    }
    for (const att of a.attachments || []) {
      const key = 'a' + att.id;
      const aname = sanitizeName(att.display_name || att.filename);
      const attUpdated = att.updated_at || a.updated_at;
      const prevF = cs.files[key];
      if (prevF && prevF.updated_at === attUpdated && fs.existsSync(path.join(root, prevF.path))) continue;
      if (att.size > maxSize) { summary.large.push(folderName + '/' + aname); continue; }
      const diskRel = existingIndex.get(aname.toLowerCase());
      if (diskRel) {
        cs.files[key] = { ...(prevF?.baseRecordId ? { baseRecordId: prevF.baseRecordId } : {}), name: aname, path: path.posix.join(folderName, diskRel), size: att.size, updated_at: attUpdated, week: null, category: '作业', source: 'existing', registeredAt: iso() };
        summary.existing.push(path.posix.join(folderName, diskRel));
        continue;
      }
      let rel = path.join(folderName, '作业', aname);
      rel = dedupeRelPath(root, rel, null, att.id);
      try {
        const attUrl = att.url || (canvas.base + '/api/v1/files/' + att.id + '/download');
        await canvas.downloadTo(attUrl, path.join(root, rel));
        cs.files[key] = { ...(prevF?.baseRecordId ? { baseRecordId: prevF.baseRecordId } : {}), name: aname, path: rel, size: att.size, updated_at: attUpdated, week: null, category: '作业', source: 'assignment', downloadedAt: iso() };
        summary.downloaded.push(rel);
        newCount++;
        log('   ⬇️ ' + rel + '（作业附件）');
      } catch (e) { summary.errors.push(rel + ': ' + e.message); log('   ❌ ' + rel + ': ' + e.message); }
    }
  }

  cs.grades = { ...(prev.grades || {}) };
  try {
    const enrolls = await canvas.list('/courses/' + c.id + '/enrollments', { user_id: 'self', 'state[]': 'active' });
    const g = enrolls[0]?.grades;
    if (g) cs.grades = {
      current_score: g.current_score != null ? Number(g.current_score) : null,
      final_score: g.final_score != null ? Number(g.final_score) : null,
      current_grade: g.current_grade || null,
      final_grade: g.final_grade || null,
    };
  } catch (e) { log('   ⚠️ 成绩获取失败：' + e.message); }

  let anns = [];
  try {
    anns = await canvas.list('/announcements', { 'context_codes[]': 'course_' + c.id });
  } catch (e) {
    log('   ⚠️ 公告接口不可用，跳过：' + String(e.message).slice(0, 120));
  }
  for (const ann of anns) {
    const key = String(ann.id);
    if (!cs.announcements[key]) {
      cs.announcements[key] = { id: ann.id, title: ann.title, posted_at: ann.posted_at, firstSeen: iso() };
      summary.newAnnouncements++;
      log('   📢 新公告：' + ann.title + '（' + (ann.posted_at || '').slice(0, 10) + '）');
    } else if (cs.announcements[key].title !== ann.title) {
      cs.announcements[key].title = ann.title;
    }
  }
  const annKeys = Object.keys(cs.announcements);
  if (annKeys.length > 200) for (const k of annKeys.slice(200)) delete cs.announcements[k];

  try {
    const det = await canvas.api('/courses/' + c.id, { 'include[]': 'syllabus_body' }).then(r => r.json());
    const body = det?.syllabus_body;
    if (body && body.length > 300) {
      const hasSyllabus = fs.readdirSync(courseDir).some(n => /^syllabus/i.test(n) && /\.(pdf|html?|docx?)$/i.test(n));
      if (!hasSyllabus) {
        fs.writeFileSync(path.join(courseDir, 'syllabus.html'), '<!doctype html><html lang="zh"><meta charset="utf-8"><title>' + (det.name || folderName) + ' Syllabus</title><body>' + body + '</body></html>');
        log('   📄 已保存 Canvas 课程大纲 syllabus.html');
      }
    }
  } catch (e) { log('   ⚠️ syllabus 获取失败：' + e.message); }

  if (newCount === 0) log('   ✅ 无新文件（共 ' + Object.keys(cs.files).length + ' 个已登记）');
  state.courses[String(c.id)] = cs;
}

export async function sync() {
  initLog('sync');
  try {
    const cfg = loadConfig();
    if (!cfg.canvas?.token) { log('❌ 缺少 Canvas token（secrets.json）'); return; }
    const canvas = new Canvas(cfg.canvas);
    log('=== Canvas 同步开始 ' + iso() + ' ===');

    const me = await canvas.api('/users/self').then(r => r.json()).catch(e => { log('❌ Token 无效或网络错误: ' + e.message); return null; });
    if (!me) return;
    log('👤 ' + me.name + ' (id=' + me.id + ')');

    const coursesRaw = await canvas.list('/courses', {
      enrollment_state: 'active', enrollment_type: 'student', 'state[]': 'available', 'include[]': 'term',
    });
    const inc = cfg.courses?.include || [];
    const exc = cfg.courses?.exclude || [];
    const courses = coursesRaw.filter(c => {
      const s = (c.course_code + ' ' + c.name).toLowerCase();
      if (inc.length && !inc.some(x => s.includes(String(x).toLowerCase()))) return false;
      if (exc.some(x => s.includes(String(x).toLowerCase()))) return false;
      return true;
    });
    log('📚 当前 Canvas 在读课程 ' + courses.length + ' 门（每次动态拉取，不写死；' + exc.length + ' 个条目被排除）：');
    for (const c of courses) log('   - [' + (c.course_code || '?') + '] ' + c.name + ' (id=' + c.id + ')');

    const root = path.resolve(ROOT, cfg.download?.root || '..');
    ensureDir(root);
    const statePath = path.join(ROOT, 'data', 'state.json');
    ensureDir(path.dirname(statePath));
    let state = { syncedAt: null, courses: {} };
    try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}

    const maxSize = (cfg.download?.maxFileSizeMB ?? 300) * 1024 * 1024;
    const summary = { newCourses: [], downloaded: [], existing: [], large: [], newAnnouncements: 0, errors: [] };
    const dueSoon = [];
    const CATS = ['讲义', '作业', '阅读', '其他'];
    const ctx = { root, state, summary, dueSoon, maxSize, CATS };

    for (const c of courses) {
      try {
        await syncCourse(canvas, c, cfg, ctx);
      } catch (e) {
        summary.errors.push('课程 ' + (c.course_code || c.name) + ': ' + e.message);
        log('❌ 课程 ' + (c.course_code || c.name) + ' 同步失败，已跳过：' + e.message);
      }
    }

    state.syncedAt = iso();
    state.baseUrl = cfg.canvas.baseUrl;
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    log('\n=== 同步完成 ===');
    log('🆕 新课程：' + (summary.newCourses.length ? summary.newCourses.join('、') : '无'));
    log('⬇️ 新下载：' + summary.downloaded.length + ' 个');
    log('♻️ 沿用本地已有文件（不重复下载）：' + summary.existing.length + ' 个');
    if (summary.large.length) log('⏭️ 跳过的超大文件：' + summary.large.length + ' 个');
    log('📢 新公告：' + summary.newAnnouncements + ' 条');
    if (summary.errors.length) log('❌ 错误：' + summary.errors.length + ' 条');
    if (dueSoon.length) {
      log('\n⏰ 未来 7 天内截止的作业：');
      dueSoon.sort((a, b) => a.due_at.localeCompare(b.due_at));
      for (const d of dueSoon) {
        const label = d.days < 0 ? '（已过期）' : d.days < 1 ? '（今天）' : '（' + Math.ceil(d.days) + ' 天后）';
        log('   ' + (d.submitted ? '✅' : '❗') + ' [' + d.course + '] ' + d.name + ' — ' + hkTime(d.due_at) + label);
      }
    } else {
      log('\n⏰ 未来 7 天没有截止的作业');
    }
    log('ℹ️ 课程列表每次同步都从 Canvas 动态获取，新增课程会自动建文件夹。');
  } finally {
    closeLog();
  }
}
