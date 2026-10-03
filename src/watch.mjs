// 高频盯防：自定义扫描窗口 + 强提醒
//
// 用途：有些课会突然放出很短的随堂 quiz（甚至课上才说）。常规的每天 08:00 / 20:00
// 同步抓不到，所以这里允许自定义「盯防规则」：
//   在指定的星期 / 时间段 / 日期区间内，用更高的频率（默认 3 分钟）轮询 Canvas，
//   一旦发现新的作业 / 测验 / 公告，立刻走桌面通知（可带提示音）+ 飞书推送，
//   并能重复提醒直到在网页上确认。
//
// 设计要点
//   - 扫描器跑在常驻的 Web 服务进程里：跨平台，不需要新增系统计划任务
//   - 不在任何窗口内时零 API 调用；窗口内每门课 2~3 个轻量请求
//   - 首次扫描只建基线（避免刷屏），但最近 1 小时内新建的内容仍会提醒
//   - 时间判断统一按香港时区，与项目其它模块一致

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadConfig, log, hkTime, desktopNotify } from './util.mjs';
import { Canvas } from './canvas.mjs';
import { lark, larkUserOpenId } from './larkrun.mjs';

// 路径可用环境变量覆盖：自检/CI 用临时目录，避免动到真实规则
export const WATCH_PATH = process.env.CANVAS_HUB_WATCH_FILE || path.join(ROOT, 'data', 'watch.json');
export const SEEN_PATH = process.env.CANVAS_HUB_SEEN_FILE || path.join(ROOT, 'data', 'watch-seen.json');
export const DEFAULT_INTERVAL_SEC = 180;
export const MIN_INTERVAL_SEC = 60;
export const MAX_INTERVAL_SEC = 1800;
export const MAX_PENDING = 20;
export const MAX_HITS = 60;
const NEW_GRACE_MS = 60 * 60 * 1000;

// ---------------- 时间（香港时区） ----------------

const WEEKDAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function hkParts(now) {
  const d = now instanceof Date ? now : new Date(now || Date.now());
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = {};
  for (const p of fmt.formatToParts(d)) parts[p.type] = p.value;
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Hong_Kong', weekday: 'short' }).format(d);
  const hour = Number(parts.hour) % 24;
  return {
    date: parts.year + '-' + parts.month + '-' + parts.day,
    weekday: WEEKDAY[wd] || 1,
    minutes: hour * 60 + Number(parts.minute),
  };
}

export function toMinutes(hhmm) {
  const bits = String(hhmm == null ? '' : hhmm).trim().split(':');
  if (bits.length !== 2) return null;
  const h = Number(bits[0]);
  const m = Number(bits[1]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/** 规则此刻是否处于「盯防中」 */
export function isRuleActive(rule, now) {
  if (!rule || rule.enabled === false) return false;
  const t = hkParts(now);
  if (rule.from && t.date < rule.from) return false;
  if (rule.to && t.date > rule.to) return false;
  if (Array.isArray(rule.days) && rule.days.length && !rule.days.includes(t.weekday)) return false;
  const s = toMinutes(rule.start);
  const e = toMinutes(rule.end);
  if (s == null || e == null) return true;
  if (s <= e) return t.minutes >= s && t.minutes <= e;
  return t.minutes >= s || t.minutes <= e;
}

export function ruleIntervalSec(rule) {
  const n = Number(rule && rule.intervalSec);
  if (!Number.isFinite(n)) return DEFAULT_INTERVAL_SEC;
  return Math.min(MAX_INTERVAL_SEC, Math.max(MIN_INTERVAL_SEC, Math.round(n)));
}

/** 规则是否「到点该扫了」 */
export function isRuleDue(rule, now) {
  if (!isRuleActive(rule, now)) return false;
  const last = Number(rule.lastScanAt || 0);
  if (!last) return true;
  return Date.now() - last >= ruleIntervalSec(rule) * 1000;
}

export function describeRule(rule) {
  const bits = [];
  if (Array.isArray(rule.courses) && rule.courses.length) bits.push(rule.courses.join('/'));
  else bits.push('全部课程');
  if (Array.isArray(rule.days) && rule.days.length) {
    const names = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    bits.push(rule.days.map((d) => names[d] || ('第' + d + '天')).join('、'));
  } else bits.push('每天');
  if (toMinutes(rule.start) != null && toMinutes(rule.end) != null) bits.push(rule.start + '-' + rule.end);
  if (rule.from || rule.to) bits.push((rule.from || '…') + '~' + (rule.to || '…'));
  bits.push('每 ' + Math.round(ruleIntervalSec(rule) / 60) + ' 分钟');
  return bits.join(' · ');
}

// ---------------- 规则与文档 ----------------

function newId() {
  return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function normalizeRule(input) {
  const r = input || {};
  const days = Array.isArray(r.days)
    ? r.days.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
    : [];
  const courses = Array.isArray(r.courses)
    ? r.courses.map((c) => String(c || '').trim()).filter(Boolean).slice(0, 20)
    : [];
  const alerts = r.alerts || {};
  return {
    id: r.id || newId(),
    label: String(r.label || '').trim().slice(0, 60) || '盯防规则',
    courses,
    days: Array.from(new Set(days)).sort(),
    start: toMinutes(r.start) == null ? '' : String(r.start),
    end: toMinutes(r.end) == null ? '' : String(r.end),
    from: /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(r.from || '')) ? String(r.from) : '',
    to: /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(r.to || '')) ? String(r.to) : '',
    intervalSec: ruleIntervalSec(r),
    alerts: {
      desktop: alerts.desktop !== false,
      sound: alerts.sound !== false,
      lark: alerts.lark !== false,
    },
    repeatMinutes: (() => {
      const n = Number(r.repeatMinutes);
      return Number.isFinite(n) ? Math.min(120, Math.max(0, Math.round(n))) : 0;
    })(),
    maxRepeats: (() => {
      const n = r.maxRepeats == null ? 2 : Number(r.maxRepeats);
      return Number.isFinite(n) ? Math.min(10, Math.max(0, Math.round(n))) : 2;
    })(),
    includeAnnouncements: r.includeAnnouncements !== false,
    enabled: r.enabled !== false,
    lastScanAt: Number(r.lastScanAt) || null,
    lastHitAt: Number(r.lastHitAt) || null,
    hitCount: Number(r.hitCount) || 0,
  };
}

export function emptyDoc() {
  return { version: 1, enabled: true, rules: [], pending: [], hits: [], lastScanAt: null, lastError: null };
}

export function loadDoc() {
  try {
    const raw = JSON.parse(fs.readFileSync(WATCH_PATH, 'utf8'));
    const doc = emptyDoc();
    doc.enabled = raw.enabled !== false;
    doc.rules = Array.isArray(raw.rules) ? raw.rules.map(normalizeRule) : [];
    doc.pending = Array.isArray(raw.pending) ? raw.pending.slice(0, MAX_PENDING) : [];
    doc.hits = Array.isArray(raw.hits) ? raw.hits.slice(0, MAX_HITS) : [];
    doc.lastScanAt = raw.lastScanAt || null;
    doc.lastError = raw.lastError || null;
    return doc;
  } catch {
    return emptyDoc();
  }
}

export function saveDoc(doc) {
  try {
    fs.mkdirSync(path.dirname(WATCH_PATH), { recursive: true });
    const tmp = WATCH_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
    fs.renameSync(tmp, WATCH_PATH);
  } catch (e) {
    log('⚠️ 盯防规则保存失败：' + (e && e.message));
  }
}

// seen 的结构版本：一旦判定口径变了（例如 quiz 的键名变化），就整份丢弃重新建基线，
// 否则所有条目都会"看起来是新的"，一次性把历史作业全部重复推一遍。
export const SEEN_VERSION = 2;

export function loadSeen() {
  try {
    const raw = JSON.parse(fs.readFileSync(SEEN_PATH, 'utf8'));
    if (!raw || typeof raw !== 'object') return { items: {}, seededAt: null, version: SEEN_VERSION };
    if (raw.version !== SEEN_VERSION) {
      // 迁移：保留 quizDisabled 这类「接口能力」缓存，清掉条目与基线时间
      return { items: {}, seededAt: null, quizDisabled: raw.quizDisabled || {}, version: SEEN_VERSION };
    }
    return raw;
  } catch {
    return { items: {}, seededAt: null, version: SEEN_VERSION };
  }
}

export function saveSeen(seen) {
  try {
    seen.version = SEEN_VERSION;
    fs.mkdirSync(path.dirname(SEEN_PATH), { recursive: true });
    // 只保留最近的 4000 条，避免无限增长
    const keys = Object.keys(seen.items || {});
    if (keys.length > 4000) {
      keys.sort((a, b) => (seen.items[a].at || 0) - (seen.items[b].at || 0));
      for (const k of keys.slice(0, keys.length - 4000)) delete seen.items[k];
    }
    const tmp = SEEN_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(seen));
    fs.renameSync(tmp, SEEN_PATH);
  } catch {}
}

// ---------------- 目标课程 ----------------

export function targetCourses(state, rules) {
  const all = Object.values((state && state.courses) || {}).map((c) => ({
    id: c.id, code: c.code || '', folder: c.folder || '', name: c.name || '',
  }));
  const wanted = [];
  const wantsAll = rules.some((r) => !r.courses || !r.courses.length);
  for (const c of all) {
    const hit = wantsAll || rules.some((r) => (r.courses || []).some((q) => {
      const needle = String(q).toLowerCase();
      return (c.code && c.code.toLowerCase().includes(needle))
        || (c.folder && c.folder.toLowerCase().includes(needle))
        || (c.name && c.name.toLowerCase().includes(needle));
    }));
    if (hit) wanted.push(c);
  }
  return wanted;
}

// ---------------- 采集与比对 ----------------

function itemKey(type, courseId, id) {
  return type + ':' + courseId + ':' + id;
}

// 归一化后的 item 用 createdAt/updatedAt（不是 Canvas 原始的 created_at）
function freshnessMs(item) {
  const t = item.createdAt || item.updatedAt || (item.raw && (item.raw.created_at || item.raw.published_at || item.raw.posted_at || item.raw.updated_at));
  const ms = t ? new Date(t).getTime() : 0;
  return ms ? Date.now() - ms : Infinity;
}

// 有些 Canvas 站点不返回 quiz_id、甚至关掉了 Quizzes 页（返回 404），
// 测验会以普通作业的形式出现，所以再用标题关键词补一次类型判定。
const QUIZ_NAME = /quiz|测验|小测|随堂|测试/i;
export function isQuizLike(item) {
  if (item && item.quiz_id) return true;
  return QUIZ_NAME.test(String((item && (item.name || item.title)) || ''));
}

async function collectCourse(canvas, course, includeAnnouncements, opts) {
  const out = [];
  const errors = [];
  let quizDisabled = false;
  const o = opts || {};
  try {
    const list = await canvas.list('/courses/' + course.id + '/assignments', { 'include[]': ['submission'], per_page: 100 });
    for (const a of list) {
      out.push({
        type: isQuizLike(a) ? 'quiz' : 'assignment',
        id: a.id,
        title: a.name,
        dueAt: a.due_at || null,
        url: a.html_url || null,
        createdAt: a.created_at || null,
        updatedAt: a.updated_at || null,
        raw: a,
      });
    }
  } catch (e) { errors.push('assignments: ' + (e && e.message)); }
  if (!o.skipQuizzes) try {
    const list = await canvas.list('/courses/' + course.id + '/quizzes', { per_page: 100 });
    for (const q of list) {
      out.push({
        type: 'quiz',
        id: 'q' + q.id,
        title: q.title,
        dueAt: q.due_at || null,
        url: q.html_url || null,
        createdAt: q.created_at || null,
        updatedAt: q.updated_at || null,
        raw: q,
      });
    }
  } catch (e) {
    const m = String((e && e.message) || '');
    // 404 = 这门课关掉了 Quizzes 页，属于正常情况：不报错，并记住以后不再请求
    if (m.indexOf('404') >= 0 || /disabled/i.test(m)) quizDisabled = true;
    else errors.push('quizzes: ' + m);
  }
  if (includeAnnouncements) {
    try {
      const list = await canvas.list('/announcements', { 'context_codes[]': 'course_' + course.id, per_page: 20 });
      for (const n of list) {
        out.push({
          type: 'announcement',
          id: n.id,
          title: n.title,
          dueAt: null,
          url: n.html_url || null,
          createdAt: n.posted_at || null,
          updatedAt: n.posted_at || null,
          raw: n,
        });
      }
    } catch (e) { errors.push('announcements: ' + (e && e.message)); }
  }
  return { items: out, errors, quizDisabled };
}

function priorityOf(type, item, nowMs) {
  let p = type === 'quiz' ? 3 : type === 'assignment' ? 2 : 1;
  if (item.dueAt) {
    const hours = (new Date(item.dueAt).getTime() - nowMs) / 3600000;
    if (hours >= -2 && hours <= 48) p += 1;
  }
  return p;
}

/**
 * 扫一轮。canvas 可注入（便于自检），其余为纯数据。
 * 返回 { hits, scannedCourses, errors }
 */
export async function scanOnce({ canvas, state, doc, seen, now, logFn }) {
  const say = typeof logFn === 'function' ? logFn : () => {};
  const nowDate = now instanceof Date ? now : new Date(now || Date.now());
  const nowMs = nowDate.getTime();
  const due = (doc.rules || []).filter((r) => isRuleDue(r, nowDate));
  if (!due.length) return { hits: [], scannedCourses: 0, errors: [], due: [] };
  const courses = targetCourses(state, due);
  if (!courses.length) return { hits: [], scannedCourses: 0, errors: [], due };
  const seeded = !seen.seededAt;
  const hits = [];
  const errors = [];
  let scanned = 0;
  for (const course of courses) {
    const includeAnn = due.some((r) => r.includeAnnouncements && courseMatches(r, course));
    let got;
    const skipQuizzes = !!(seen.quizDisabled && seen.quizDisabled[String(course.id)]);
    try {
      got = await collectCourse(canvas, course, includeAnn, { skipQuizzes });
    } catch (e) {
      errors.push(course.folder + ': ' + ((e && e.message) || e));
      continue;
    }
    if (got.quizDisabled) {
      if (!seen.quizDisabled) seen.quizDisabled = {};
      seen.quizDisabled[String(course.id)] = true;
    }
    scanned++;
    errors.push(...got.errors.map((x) => course.folder + ' ' + x));
    for (const item of got.items) {
      const key = itemKey(item.type, course.id, item.id);
      const prev = seen.items[key];
      const rec = { type: item.type, title: item.title, dueAt: item.dueAt, at: nowMs, courseId: course.id };
      if (!prev) {
        seen.items[key] = rec;
        const fresh = freshnessMs(item) <= NEW_GRACE_MS;
        if (!seeded || fresh) {
          hits.push({ ...item, key, courseId: course.id, courseLabel: course.folder || course.code, kind: 'new', priority: priorityOf(item.type, item, nowMs) });
        }
        continue;
      }
      // 已见过：只有「截止时间从无到有 / 发生变动」才算命中（随堂 quiz 常见特征）
      const changed = (prev.dueAt || '') !== (item.dueAt || '');
      seen.items[key] = { ...prev, ...rec, dueAt: item.dueAt, title: item.title };
      if (changed) {
        hits.push({ ...item, key, courseId: course.id, courseLabel: course.folder || course.code, kind: 'changed', prevDueAt: prev.dueAt || null, priority: priorityOf(item.type, item, nowMs) + 1 });
      }
    }
  }
  seen.seededAt = seen.seededAt || nowMs;
  if (!hits.length) say('盯防扫描 ' + scanned + ' 门课，无新增');
  return { hits, scannedCourses: scanned, errors, due };
}

export function courseMatches(rule, course) {
  if (!rule.courses || !rule.courses.length) return true;
  return rule.courses.some((q) => {
    const needle = String(q).toLowerCase();
    return (course.code && course.code.toLowerCase().includes(needle))
      || (course.folder && course.folder.toLowerCase().includes(needle))
      || (course.name && course.name.toLowerCase().includes(needle));
  });
}

// ---------------- 强提醒 ----------------

export function hitMarkdown(hit, { repeat } = {}) {
  const kind = hit.kind === 'changed' ? '截止时间变动' : '新内容';
  const icon = hit.type === 'quiz' ? '🚨' : hit.type === 'assignment' ? '❗' : '📣';
  const lines = [];
  lines.push((repeat ? '🔔 **还没确认** · ' : '') + icon + ' **Canvas 盯防命中：' + kind + '**');
  lines.push('');
  lines.push('- 课程：' + hit.courseLabel);
  lines.push('- 类型：' + (hit.type === 'quiz' ? '测验 / Quiz' : hit.type === 'assignment' ? '作业' : '公告'));
  lines.push('- 标题：' + hit.title);
  if (hit.dueAt) lines.push('- 截止：' + hkTime(hit.dueAt));
  else if (hit.kind === 'changed') lines.push('- 截止：已取消（原 ' + (hit.prevDueAt ? hkTime(hit.prevDueAt) : '无') + '）');
  if (hit.url) lines.push('- 打开：' + hit.url);
  return lines.join('\n');
}

export function alertHits(doc, hits, { logFn } = {}) {
  const say = typeof logFn === 'function' ? logFn : log;
  const cfg = loadConfig();
  const openId = cfg.channels?.larkIM === false ? '' : larkUserOpenId();
  const desktopOn = cfg.channels?.desktop !== false && cfg.channels?.macos !== false;
  let sent = 0;
  for (const hit of hits) {
    const wantDesktop = desktopOn && hit.alertsDesktop !== false;
    const wantSound = hit.alertsSound !== false;
    const wantLark = !!openId && hit.alertsLark !== false;
    if (wantDesktop || wantSound) {
      desktopNotify('🚨 盯防命中 · ' + hit.courseLabel, (hit.type === 'quiz' ? 'Quiz' : hit.type === 'assignment' ? '作业' : '公告') + '：' + hit.title + (hit.dueAt ? '（截止 ' + hkTime(hit.dueAt) + '）' : ''), { sound: wantSound });
      sent++;
    }
    if (wantLark) {
      const r = lark(['im', '+messages-send', '--as', 'bot', '--user-id', openId, '--markdown', hitMarkdown(hit), '--idempotency-key', 'watch-' + hit.key + '-' + Date.now()]);
      if (r.ok) sent++;
      else say('❌ 盯防飞书推送失败：' + String(r.err || r.raw || '').slice(0, 160));
    }
    say('🚨 盯防命中：[' + hit.courseLabel + '] ' + hit.title + (hit.dueAt ? ' · 截止 ' + hkTime(hit.dueAt) : ''));
  }
  return sent;
}

export function repeatDue(pending, rule, nowMs) {
  if (!pending || pending.acked) return false;
  if (!rule || !rule.repeatMinutes) return false;
  if ((pending.alertsSent || 1) > (rule.maxRepeats || 0)) return false;
  return nowMs - (pending.lastSentAt || pending.firstSeenAt || 0) >= rule.repeatMinutes * 60000;
}

/** 一轮完整的盯防检查（服务器定时器与 CLI 都调它） */
export async function watchTick({ now, logFn } = {}) {
  const say = typeof logFn === 'function' ? logFn : log;
  const doc = loadDoc();
  if (!doc.enabled) return { ok: true, skipped: 'disabled' };
  const nowDate = now instanceof Date ? now : new Date(now || Date.now());
  const due = doc.rules.filter((r) => isRuleDue(r, nowDate));
  const pendingRepeat = (doc.pending || []).filter((p) => !p.acked);
  if (!due.length && !pendingRepeat.length) return { ok: true, skipped: 'idle' };
  const cfg = loadConfig();
  if (!cfg.canvas || !cfg.canvas.token) return { ok: false, error: 'no-token' };
  const canvas = new Canvas({ baseUrl: cfg.canvas.baseUrl, token: cfg.canvas.token, timeoutMs: 20000, minIntervalMs: 400 });
  const state = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'state.json'), 'utf8')); } catch { return { courses: {} }; }
  })();
  const seen = loadSeen();
  const result = await scanOnce({ canvas, state, doc, seen, now: nowDate, logFn: say });
  saveSeen(seen);

  // 命中写进 pending（附带该命中适用的提醒设置）
  const stamp = Date.now();
  for (const hit of result.hits) {
    const rule = due.find((r) => courseMatches(r, { code: hit.courseLabel, folder: hit.courseLabel, name: '' })) || due[0] || {};
    doc.pending.unshift({
      id: 'h' + stamp.toString(36) + Math.random().toString(36).slice(2, 5),
      key: hit.key, type: hit.type, title: hit.title, courseLabel: hit.courseLabel,
      dueAt: hit.dueAt, url: hit.url, kind: hit.kind, priority: hit.priority,
      firstSeenAt: stamp, lastSentAt: null, alertsSent: 0, acked: false,
      ruleId: rule.id || null,
      alertsDesktop: rule.alerts ? rule.alerts.desktop : true,
      alertsSound: rule.alerts ? rule.alerts.sound : true,
      alertsLark: rule.alerts ? rule.alerts.lark : true,
    });
  }
  if (doc.pending.length > MAX_PENDING) doc.pending = doc.pending.slice(0, MAX_PENDING);

  // 首次提醒：立即发
  const fresh = doc.pending.filter((p) => !p.acked && !p.alertsSent);
  if (fresh.length) {
    alertHits(doc, fresh, { logFn: say });
    for (const p of fresh) { p.alertsSent = 1; p.lastSentAt = Date.now(); }
  }
  // 重复提醒：隔一段时间再推一次，直到在网页上确认
  for (const p of doc.pending) {
    if (p.acked || !p.alertsSent) continue;
    const rule = doc.rules.find((r) => r.id === p.ruleId) || {};
    if (!repeatDue(p, rule, Date.now())) continue;
    const r = larkUserOpenId();
    const cfg2 = loadConfig();
    if (cfg2.channels?.desktop !== false && p.alertsDesktop !== false) {
      desktopNotify('🔔 仍未确认 · ' + p.courseLabel, p.title + '（第 ' + p.alertsSent + ' 次提醒）', { sound: p.alertsSound !== false });
    }
    if (r && p.alertsLark !== false) {
      lark(['im', '+messages-send', '--as', 'bot', '--user-id', r, '--markdown', hitMarkdown(p, { repeat: true }), '--idempotency-key', 'watch-r-' + p.id + '-' + p.alertsSent]);
    }
    p.alertsSent += 1;
    p.lastSentAt = Date.now();
    say('🔔 重复提醒：' + p.title + '（第 ' + p.alertsSent + ' 次）');
  }

  // 命中历史
  for (const hit of result.hits) {
    doc.hits.unshift({ key: hit.key, type: hit.type, title: hit.title, courseLabel: hit.courseLabel, dueAt: hit.dueAt, url: hit.url, kind: hit.kind, priority: hit.priority, at: stamp });
  }
  if (doc.hits.length > MAX_HITS) doc.hits = doc.hits.slice(0, MAX_HITS);

  for (const rule of due) {
    const r = doc.rules.find((x) => x.id === rule.id);
    if (!r) continue;
    r.lastScanAt = stamp;
    const mine = result.hits.filter((h) => courseMatches(r, { code: h.courseLabel, folder: h.courseLabel, name: '' }));
    if (mine.length) { r.lastHitAt = stamp; r.hitCount = (r.hitCount || 0) + mine.length; }
  }
  doc.lastScanAt = stamp;
  doc.lastError = result.errors.length ? result.errors.slice(0, 3).join(' | ') : null;
  saveDoc(doc);
  return { ok: true, hits: result.hits, scanned: result.scannedCourses, pending: doc.pending.filter((p) => !p.acked).length, errors: result.errors };
}

/** CLI：node cli.mjs watch [--status] [--force] */
export async function watchCommand({ statusOnly, force } = {}) {
  const st = watchStatus();
  log("=== 高频盯防 ===");
  log("总开关：" + (st.enabled ? "开启" : "关闭") + " · 规则 " + st.total + " 条 · 当前生效 " + st.active + " 条");
  for (const r of st.rules) {
    log("  " + (r.enabled === false ? "⏸" : r.active ? "🟢" : "⚪") + " " + r.label + " — " + r.description + (r.hitCount ? " · 累计命中 " + r.hitCount + " 次" : ""));
  }
  if (!st.total) log("  （还没有规则：可在网页「设置 → 高频盯防」里按课程 / 时段添加）");
  if (st.lastScanAt) log("上次扫描：" + hkTime(new Date(st.lastScanAt).toISOString()));
  if (st.lastError) log("⚠️ 最近错误：" + st.lastError);
  if (st.pending.length) log("⏳ 待确认命中 " + st.pending.length + " 项（在网页上点「知道了」即停止重复提醒）");
  if (statusOnly) return;
  const doc = loadDoc();
  const active = doc.rules.filter((r) => isRuleActive(r, new Date()));
  if (!active.length && !force) { log("当前不在任何盯防窗口内，未发起扫描（要强制扫描加 --force）。"); return; }
  if (force) {
    for (const r of doc.rules) r.lastScanAt = null;
    saveDoc(doc);
  }
  log("开始扫描…");
  const r = await watchTick();
  if (r.skipped) log("跳过：" + r.skipped);
  else if (r.ok === false) log("❌ 扫描失败：" + (r.error || ""));
  else log("✅ 扫描 " + r.scanned + " 门课，命中 " + (r.hits || []).length + " 项，待确认 " + (r.pending || 0) + " 项");
  if (r.errors && r.errors.length) log("⚠️ 部分接口失败：" + r.errors.slice(0, 3).join(" | "));
}

export function watchStatus(now) {
  const doc = loadDoc();
  const nowDate = now instanceof Date ? now : new Date(now || Date.now());
  return {
    enabled: doc.enabled,
    total: doc.rules.length,
    active: doc.rules.filter((r) => isRuleActive(r, nowDate)).length,
    rules: doc.rules.map((r) => ({ ...r, active: isRuleActive(r, nowDate), description: describeRule(r) })),
    pending: (doc.pending || []).filter((p) => !p.acked),
    hits: (doc.hits || []).slice(0, 20),
    lastScanAt: doc.lastScanAt,
    lastError: doc.lastError,
    nextDueInSec: (() => {
      const waits = doc.rules.filter((r) => isRuleActive(r, nowDate)).map((r) => {
        const last = Number(r.lastScanAt || 0);
        return last ? Math.max(0, Math.round((last + ruleIntervalSec(r) * 1000 - Date.now()) / 1000)) : 0;
      });
      return waits.length ? Math.min(...waits) : null;
    })(),
  };
}
