import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadConfig, log, hkTime } from './util.mjs';

const HORIZON_DAYS = 10;

const CSS = [
  ':root { --bg:#f4f6fb; --card:#ffffff; --ink:#1f2430; --sub:#6b7280; --line:#e5e7eb; --acc:#4f46e5; --ok:#16a34a; --warn:#d97706; --bad:#dc2626; }',
  '* { box-sizing: border-box; }',
  'body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif; background:var(--bg); color:var(--ink); }',
  'header { background:linear-gradient(135deg,#4f46e5,#7c3aed); color:#fff; padding:28px 32px 22px; }',
  'header h1 { margin:0 0 6px; font-size:24px; }',
  'header .sub { opacity:.85; font-size:13px; }',
  '.pills { display:flex; gap:10px; margin-top:16px; flex-wrap:wrap; }',
  'button.pill { cursor:pointer; border:none; font:inherit; color:#fff; background:rgba(255,255,255,.16); border-radius:999px; padding:6px 14px; font-size:13px; }',
  'button.pill:hover { background:rgba(255,255,255,.3); }',
  'main { max-width:1100px; margin:24px auto; padding:0 20px 60px; }',
  'h2 { font-size:17px; margin:28px 0 12px; }',
  '.card { background:var(--card); border-radius:14px; padding:18px 20px; box-shadow:0 1px 3px rgba(15,23,42,.08); margin-bottom:14px; }',
  '.clickable { cursor:pointer; transition:box-shadow .15s ease; }',
  '.clickable:hover { box-shadow:0 4px 14px rgba(79,70,229,.18); }',
  '.due-row { display:flex; align-items:center; gap:14px; padding:10px 0; border-bottom:1px solid var(--line); }',
  '.due-row:last-child { border-bottom:none; }',
  '.badge { flex:0 0 auto; background:#eef2ff; color:var(--acc); border-radius:8px; padding:4px 10px; font-size:12px; font-weight:600; max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
  '.due-name { flex:1 1 auto; font-size:14px; }',
  '.due-time { flex:0 0 auto; color:var(--sub); font-size:12px; }',
  '.chip { border-radius:999px; padding:3px 10px; font-size:12px; font-weight:600; }',
  '.chip.ok { background:#ecfdf5; color:var(--ok); }',
  '.chip.bad { background:#fef2f2; color:var(--bad); }',
  '.chip.warn { background:#fffbeb; color:var(--warn); }',
  '.cat { background:#f1f5f9; border-radius:8px; padding:4px 10px; font-size:12px; color:var(--sub); flex:0 0 auto; }',
  '.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(330px,1fr)); gap:16px; }',
  '.course-card h3 { margin:0 0 4px; font-size:16px; }',
  '.course-card .code { color:var(--sub); font-size:12px; margin-bottom:10px; }',
  '.cats { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; }',
  '.cat-box { background:#f1f5f9; border-radius:8px; padding:4px 10px; font-size:12px; color:var(--sub); }',
  '.bar { height:8px; background:#eef0f4; border-radius:999px; overflow:hidden; margin:6px 0 10px; }',
  '.bar > div { height:100%; background:var(--acc); border-radius:999px; }',
  '.mini { font-size:12px; color:var(--sub); margin:4px 0; }',
  '.mini a { color:var(--acc); text-decoration:none; margin-right:8px; }',
  '.mini a:hover { text-decoration:underline; }',
  'ul.ann { margin:6px 0 0; padding-left:18px; }',
  'ul.ann li { font-size:12px; color:var(--sub); margin:3px 0; }',
  'footer { text-align:center; color:var(--sub); font-size:12px; padding:20px; }',
  '.empty { color:var(--sub); font-size:13px; }',
  '.overlay { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; z-index:50; padding:20px; }',
  '.dialog { background:#fff; border-radius:16px; width:100%; max-width:720px; max-height:82vh; display:flex; flex-direction:column; overflow:hidden; }',
  '.dhead { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid var(--line); }',
  '.dtitle { font-weight:600; font-size:15px; }',
  '.xbtn { border:none; background:none; font-size:16px; cursor:pointer; color:var(--sub); padding:4px 8px; }',
  '.dbody { overflow:auto; padding:16px 18px; }',
  '.mh { font-weight:600; font-size:13px; color:var(--sub); margin:14px 0 6px; }',
  '.mh:first-child { margin-top:0; }',
  '.code { color:var(--sub); font-size:12px; margin-bottom:10px; }',
].join('\n');

const RENDER_JS = [
  'var app = document.getElementById("app");',
  'function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }',
  'function fileLink(p, label) { var a = document.createElement("a"); a.href = "file://" + encodeURI(p); a.textContent = label || p.split("/").pop(); a.title = p; return a; }',
  'function fmtSize(b) { if (!b && b !== 0) return ""; if (b < 1048576) return Math.round(b / 1024) + " KB"; return (b / 1048576).toFixed(1) + " MB"; }',
  'function fmt(days) {',
  '  if (days < 0) return "已过期 " + Math.ceil(-days) + " 天";',
  '  if (days < 1) { var h = Math.max(0, Math.round(days * 24)); return h <= 0 ? "即将截止" : "剩 " + h + " 小时"; }',
  '  var d = Math.floor(days), h = Math.round((days - d) * 24);',
  '  return "剩 " + d + " 天" + (h ? " " + h + " 小时" : "");',
  '}',
  'function openModal(title, node) {',
  '  var ov = document.createElement("div"); ov.className = "overlay";',
  '  var dlg = document.createElement("div"); dlg.className = "dialog";',
  '  var head = document.createElement("div"); head.className = "dhead";',
  '  head.appendChild(el("div", "dtitle", title));',
  '  var x = document.createElement("button"); x.className = "xbtn"; x.textContent = "✕";',
  '  x.onclick = function () { ov.remove(); };',
  '  head.appendChild(x);',
  '  var body = document.createElement("div"); body.className = "dbody";',
  '  body.appendChild(node);',
  '  dlg.appendChild(head); dlg.appendChild(body); ov.appendChild(dlg);',
  '  ov.onclick = function (e) { if (e.target === ov) ov.remove(); };',
  '  function esc(e) { if (e.key === "Escape") { ov.remove(); document.removeEventListener("keydown", esc); } }',
  '  document.addEventListener("keydown", esc);',
  '  document.body.appendChild(ov);',
  '}',
  'function statusChip(d) {',
  '  if (d.submission && d.submission.submitted_at) return el("span", "chip ok", "已提交");',
  '  if (d.days < 0) return el("span", "chip bad", "已过期");',
  '  if (d.days < 2) return el("span", "chip bad", "紧急");',
  '  return el("span", "chip warn", "未提交");',
  '}',
  'function dueRow(d, showCourse) {',
  '  var row = el("div", "due-row");',
  '  if (showCourse) row.appendChild(el("span", "badge", d.course));',
  '  row.appendChild(el("span", "due-name", d.name));',
  '  row.appendChild(statusChip(d));',
  '  row.appendChild(el("span", "due-time", fmt(d.days) + " · " + d.dueLabel));',
  '  return row;',
  '}',
  'function fileRow(f, showCourse) {',
  '  var row = el("div", "due-row");',
  '  if (showCourse) row.appendChild(el("span", "badge", f.course || ""));',
  '  row.appendChild(el("span", "cat", f.category || "其他"));',
  '  row.appendChild(el("span", "due-name", f.name));',
  '  row.appendChild(fileLink(f.abs, "打开"));',
  '  row.appendChild(el("span", "due-time", fmtSize(f.size)));',
  '  return row;',
  '}',
  'function dueListModal() {',
  '  var wrap = document.createElement("div");',
  '  if (!DATA.dues.length) wrap.appendChild(el("div", "empty", "暂无临近截止的作业 🎉"));',
  '  else DATA.dues.forEach(function (d) { wrap.appendChild(dueRow(d, true)); });',
  '  return wrap;',
  '}',
  'function pendingModal() {',
  '  var wrap = document.createElement("div");',
  '  if (!DATA.pendingList.length) wrap.appendChild(el("div", "empty", "太棒了，没有未提交的作业 🎉"));',
  '  else DATA.pendingList.forEach(function (d) { wrap.appendChild(dueRow(d, true)); });',
  '  return wrap;',
  '}',
  'function fileListModal() {',
  '  var wrap = document.createElement("div");',
  '  DATA.courses.forEach(function (c) {',
  '    wrap.appendChild(el("div", "mh", c.folder + "（" + c.files.length + "）"));',
  '    var box = el("div", "card");',
  '    if (!c.files.length) box.appendChild(el("div", "empty", "暂无文件"));',
  '    c.files.forEach(function (f) { box.appendChild(fileRow(f, false)); });',
  '    wrap.appendChild(box);',
  '  });',
  '  return wrap;',
  '}',
  'function courseModal(c) {',
  '  var wrap = document.createElement("div");',
  '  wrap.appendChild(el("div", "code", c.code + " · " + c.fullName));',
  '  wrap.appendChild(el("div", "mh", "作业（" + c.assignments.length + "）"));',
  '  if (!c.assignments.length) wrap.appendChild(el("div", "empty", "暂无作业"));',
  '  else {',
  '    var list = c.assignments.slice().sort(function (a, b) { return String(a.due_at || "9999").localeCompare(String(b.due_at || "9999")); });',
  '    var box = el("div", "card");',
  '    list.forEach(function (a) {',
  '      var row = el("div", "due-row");',
  '      row.appendChild(el("span", "due-name", a.name));',
  '      if (a.due_at) {',
  '        row.appendChild(statusChip({ submission: a.submission, days: (new Date(a.due_at).getTime() - Date.now()) / 86400000 }));',
  '        row.appendChild(el("span", "due-time", a.dueLabel));',
  '      } else row.appendChild(el("span", "chip warn", "无截止"));',
  '      if (a.points != null) row.appendChild(el("span", "due-time", a.points + " 分"));',
  '      box.appendChild(row);',
  '    });',
  '    wrap.appendChild(box);',
  '  }',
  '  ["讲义", "作业", "阅读", "其他"].forEach(function (cat) {',
  '    var fs2 = c.files.filter(function (f) { return f.category === cat; });',
  '    if (!fs2.length) return;',
  '    wrap.appendChild(el("div", "mh", cat + "（" + fs2.length + "）"));',
  '    var box2 = el("div", "card");',
  '    fs2.forEach(function (f) { box2.appendChild(fileRow(f, false)); });',
  '    wrap.appendChild(box2);',
  '  });',
  '  if (c.announcements.length) {',
  '    wrap.appendChild(el("div", "mh", "公告（" + c.announcements.length + "）"));',
  '    var ul = el("ul", "ann");',
  '    c.announcements.forEach(function (a) { ul.appendChild(el("li", "", "📢 " + a.title + (a.posted_at ? "（" + a.posted_at.slice(0, 10) + "）" : ""))); });',
  '    wrap.appendChild(ul);',
  '  }',
  '  return wrap;',
  '}',
  'function courseListModal() {',
  '  var wrap = document.createElement("div");',
  '  DATA.courses.forEach(function (c) {',
  '    var row = el("div", "due-row clickable");',
  '    row.appendChild(el("span", "badge", c.code));',
  '    row.appendChild(el("span", "due-name", c.folder));',
  '    row.appendChild(el("span", "due-time", c.files.length + " 文件 · " + c.assignments.length + " 作业"));',
  '    row.onclick = function () { openModal(c.folder, courseModal(c)); };',
  '    wrap.appendChild(row);',
  '  });',
  '  return wrap;',
  '}',
  'var h = document.createElement("header");',
  'h.appendChild(el("h1", "", "Canvas 课程管家"));',
  'h.appendChild(el("div", "sub", "数据来源：Canvas API · 同步于 " + (DATA.syncedAt || "-") + " · 点击上方数字查看明细"));',
  'var pills = el("div", "pills");',
  'function pill(label, node) { var b = document.createElement("button"); b.className = "pill"; b.textContent = label; b.onclick = function () { openModal(label, node); }; return b; }',
  'pills.appendChild(pill("课程 " + DATA.courses.length, courseListModal()));',
  'pills.appendChild(pill("文件 " + DATA.totalFiles, fileListModal()));',
  'pills.appendChild(pill("10 天内截止 " + DATA.dues.length, dueListModal()));',
  'pills.appendChild(pill("未提交 " + DATA.pendingList.length, pendingModal()));',
  'h.appendChild(pills);',
  'document.body.insertBefore(h, document.body.firstChild);',
  'var dueSec = el("section");',
  'dueSec.appendChild(el("h2", "", "⏰ 未来 10 天截止"));',
  'var dueCard = el("div", "card");',
  'if (!DATA.dues.length) dueCard.appendChild(el("div", "empty", "暂无临近截止的作业 🎉"));',
  'DATA.dues.forEach(function (d) { dueCard.appendChild(dueRow(d, true)); });',
  'dueSec.appendChild(dueCard);',
  'app.appendChild(dueSec);',
  'var gridSec = el("section");',
  'gridSec.appendChild(el("h2", "", "📁 课程总览（点击卡片看详情）"));',
  'var grid = el("div", "grid");',
  'DATA.courses.forEach(function (c) {',
  '  var card = el("div", "card course-card clickable");',
  '  card.onclick = function () { openModal(c.folder, courseModal(c)); };',
  '  card.appendChild(el("h3", "", c.folder));',
  '  card.appendChild(el("div", "code", c.code));',
  '  var cats = el("div", "cats");',
  '  ["讲义", "作业", "阅读", "其他"].forEach(function (k) { if (c.byCat[k]) cats.appendChild(el("span", "cat-box", k + " " + c.byCat[k])); });',
  '  if (!Object.keys(c.byCat).length) cats.appendChild(el("span", "cat-box", "暂无文件"));',
  '  card.appendChild(cats);',
  '  var total = c.assignments.length;',
  '  var done = c.assignments.filter(function (a) { return a.submission && a.submission.submitted_at; }).length;',
  '  card.appendChild(el("div", "mini", "作业进度：" + done + " / " + total));',
  '  var bar = el("div", "bar");',
  '  var fill = el("div");',
  '  fill.style.width = (total ? Math.round(done / total * 100) : 0) + "%";',
  '  bar.appendChild(fill);',
  '  card.appendChild(bar);',
  '  var next = c.assignments.filter(function (a) { return a.due_at && !(a.submission && a.submission.submitted_at) && new Date(a.due_at).getTime() > Date.now(); }).sort(function (a, b) { return a.due_at.localeCompare(b.due_at); })[0];',
  '  if (next) card.appendChild(el("div", "mini", "下一次截止：" + next.name + " · " + next.dueLabel));',
  '  var recents = c.files.filter(function (f) { return f.downloadedAt; }).sort(function (a, b) { return String(b.downloadedAt).localeCompare(String(a.downloadedAt)); }).slice(0, 3);',
  '  if (recents.length) {',
  '    var t = el("div", "mini", "最近下载：");',
  '    recents.forEach(function (f) { t.appendChild(fileLink(f.abs)); });',
  '    card.appendChild(t);',
  '  }',
  '  if (c.announcements.length) {',
  '    var ul = el("ul", "ann");',
  '    c.announcements.forEach(function (a) { ul.appendChild(el("li", "", "📢 " + a.title)); });',
  '    card.appendChild(ul);',
  '  }',
  '  grid.appendChild(card);',
  '});',
  'gridSec.appendChild(grid);',
  'app.appendChild(gridSec);',
  'var nfSec = el("section");',
  'nfSec.appendChild(el("h2", "", "🆕 最近 7 天新文件"));',
  'var nfCard = el("div", "card");',
  'if (!DATA.newFiles.length) nfCard.appendChild(el("div", "empty", "暂无新文件。"));',
  'DATA.newFiles.slice(0, 30).forEach(function (f) {',
  '  var row = el("div", "due-row");',
  '  row.appendChild(el("span", "badge", f.course));',
  '  row.appendChild(el("span", "due-name", (f.category ? f.category + " · " : "") + f.name));',
  '  row.appendChild(fileLink(f.abs, "打开"));',
  '  row.appendChild(el("span", "due-time", f.downloadedAt ? f.downloadedAt.slice(0, 10) : ""));',
  '  nfCard.appendChild(row);',
  '});',
  'nfSec.appendChild(nfCard);',
  'app.appendChild(nfSec);',
].join('\n');

export function dashboard() {
  const statePath = path.join(ROOT, 'data', 'state.json');
  if (!fs.existsSync(statePath)) { log('没有同步数据，先运行 node cli.mjs sync'); return; }
  const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const cfg = loadConfig();
  const root = path.resolve(ROOT, cfg.download?.root || '..');
  const now = Date.now();

  const courses = Object.values(s.courses).map((c) => {
    const files = Object.values(c.files || {}).map((f) => ({
      ...f,
      abs: path.resolve(root, f.path),
    }));
    const byCat = {};
    for (const f of files) byCat[f.category] = (byCat[f.category] || 0) + 1;
    const assignments = (c.assignments || []).map((a) => ({ ...a, course: c.folder, dueLabel: a.due_at ? hkTime(a.due_at) : null }));
    const announcements = Object.values(c.announcements || {})
      .sort((a, b) => String(b.posted_at).localeCompare(String(a.posted_at)))
      .slice(0, 5);
    return { code: c.code, folder: c.folder, fullName: c.name, files, byCat, assignments, announcements };
  });

  const dues = [];
  for (const a of courses.flatMap((c) => c.assignments)) {
    if (!a.due_at) continue;
    const days = (new Date(a.due_at).getTime() - now) / 86400000;
    if (days >= -1 && days <= HORIZON_DAYS) dues.push({ ...a, days });
  }
  dues.sort((a, b) => a.due_at.localeCompare(b.due_at));

  const pendingList = [];
  for (const a of courses.flatMap((c) => c.assignments)) {
    if (!a.due_at) continue;
    if (a.submission && a.submission.submitted_at) continue;
    const days = (new Date(a.due_at).getTime() - now) / 86400000;
    if (days >= -0.1) pendingList.push({ ...a, days });
  }
  pendingList.sort((a, b) => a.due_at.localeCompare(b.due_at));

  const newFiles = [];
  for (const c of courses) {
    for (const f of c.files) {
      if (f.downloadedAt && now - new Date(f.downloadedAt).getTime() < 7 * 86400000) newFiles.push({ ...f, course: c.folder });
    }
  }
  newFiles.sort((a, b) => String(b.downloadedAt).localeCompare(String(a.downloadedAt)));

  const totalFiles = courses.reduce((n, c) => n + c.files.length, 0);

  const data = { syncedAt: s.syncedAt, courses, dues, newFiles, pendingList, totalFiles };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');

  const html = [
    '<!doctype html><html lang="zh"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Canvas 课程管家</title><style>', CSS, '</style></head><body>',
    '<main id="app"></main>',
    '<footer>Canvas 课程管家 · canvas-hub · 点击卡片和上方统计可查看明细 · 文件名可打开本地文件</footer>',
    '<script>const DATA = ', json, ';</script>',
    '<script>', RENDER_JS, '</script>',
    '</body></html>',
  ].join('\n');

  const outDir = path.join(ROOT, 'out', 'dashboard');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  log('✅ 已生成仪表盘：out/dashboard/index.html（浏览器打开或用 open 命令）');
}
