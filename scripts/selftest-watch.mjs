// 高频盯防自检（零依赖）
//   node scripts/selftest-watch.mjs
// 覆盖：窗口判断（星期/时段/日期区间/跨零点）、规则归一化、采集比对（新内容/截止变动/去重）、
//      首次基线不刷屏、目标课程匹配、重复提醒判定。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-test-'));
process.env.CANVAS_HUB_WATCH_FILE = path.join(TMP, 'watch.json');
process.env.CANVAS_HUB_SEEN_FILE = path.join(TMP, 'watch-seen.json');

const W = await import('../src/watch.mjs');

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (detail === undefined ? '' : ' → ' + JSON.stringify(detail))); }
}

// 构造一个「香港时间」的 Date：给出日期与时分
function hk(dateStr, hhmm) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - 8, mm));
}

console.log('[1] 时间与窗口判断');
{
  check('toMinutes 正常', W.toMinutes('09:30') === 570);
  check('toMinutes 非法返回 null', W.toMinutes('25:00') === null && W.toMinutes('abc') === null && W.toMinutes('') === null);

  const p = W.hkParts(hk('2026-09-15', '14:05'));
  check('hkParts 日期正确', p.date === '2026-09-15', p);
  check('hkParts 星期正确（周二）', p.weekday === 2, p);
  check('hkParts 分钟数正确', p.minutes === 14 * 60 + 5, p);

  const base = { enabled: true, days: [2], start: '09:00', end: '18:00', from: '', to: '' };
  check('周二 14:00 在窗口内', W.isRuleActive(base, hk('2026-09-15', '14:00')) === true);
  check('周二 08:59 不在窗口内', W.isRuleActive(base, hk('2026-09-15', '08:59')) === false);
  check('周二 18:01 不在窗口内', W.isRuleActive(base, hk('2026-09-15', '18:01')) === false);
  check('周三不在窗口内（星期过滤）', W.isRuleActive(base, hk('2026-09-16', '14:00')) === false);
  check('未启用直接为 false', W.isRuleActive({ ...base, enabled: false }, hk('2026-09-15', '14:00')) === false);

  const ranged = { ...base, from: '2026-09-14', to: '2026-09-20' };
  check('日期区间内', W.isRuleActive(ranged, hk('2026-09-15', '14:00')) === true);
  check('早于区间开始', W.isRuleActive(ranged, hk('2026-09-08', '14:00')) === false);
  check('晚于区间结束', W.isRuleActive({ ...base, from: '2026-09-01', to: '2026-09-10' }, hk('2026-09-15', '14:00')) === false);

  const overnight = { enabled: true, days: [], start: '22:00', end: '02:00', from: '', to: '' };
  check('跨零点 23:00 命中', W.isRuleActive(overnight, hk('2026-09-15', '23:00')) === true);
  check('跨零点 01:00 命中', W.isRuleActive(overnight, hk('2026-09-16', '01:00')) === true);
  check('跨零点 03:00 不命中', W.isRuleActive(overnight, hk('2026-09-16', '03:00')) === false);

  const always = { enabled: true, days: [], start: '', end: '', from: '', to: '' };
  check('没填时段=全天', W.isRuleActive(always, hk('2026-09-15', '03:00')) === true);
}

console.log('[2] 规则归一化');
{
  const r = W.normalizeRule({ label: '6018 随堂', courses: ['6018', ' 6018 ', ''], days: [3, 1, 1, 9], start: '09:00', end: '18:00', intervalSec: 5 });
  check('生成 id', typeof r.id === 'string' && r.id.length > 2);
  check('课程去空去重', JSON.stringify(r.courses) === JSON.stringify(['6018', '6018']), r.courses);
  check('星期去重排序并丢掉越界值', JSON.stringify(r.days) === JSON.stringify([1, 3]), r.days);
  check('间隔被抬到下限 60', r.intervalSec === W.MIN_INTERVAL_SEC, r.intervalSec);
  check('间隔超上限被压到 1800', W.normalizeRule({ intervalSec: 99999 }).intervalSec === W.MAX_INTERVAL_SEC);
  check('默认重复提醒 2 次', W.normalizeRule({}).maxRepeats === 2);
  check('默认不重复间隔', W.normalizeRule({}).repeatMinutes === 0);
  check('非法日期被丢弃', W.normalizeRule({ from: '2026/09/15', to: 'xx' }).from === '' && W.normalizeRule({}).to === '');
  check('默认开启', W.normalizeRule({}).enabled === true);
  check('alerts 默认全开', JSON.stringify(W.normalizeRule({}).alerts) === JSON.stringify({ desktop: true, sound: true, lark: true }));
  check('describeRule 生成可读描述', W.describeRule(r).includes('6018') && W.describeRule(r).includes('周一'), W.describeRule(r));
}

console.log('[3] 目标课程匹配');
{
  const state = { courses: {
    a: { id: 1, code: '202609DSC5002', name: 'DSC5002 Exploratory', folder: '5002 dsc exploratory' },
    b: { id: 2, code: '202609DSC6018', name: 'DSC6018 Health', folder: '6018 health' },
    c: { id: 3, code: '202609DSC6008', name: 'DSC6008 Design', folder: '6008 design' },
  } };
  const rules = [W.normalizeRule({ courses: ['6018'] })];
  const t = W.targetCourses(state, rules);
  check('按课程号筛选命中一门', t.length === 1 && t[0].id === 2, t.map((x) => x.code));
  const all = W.targetCourses(state, [W.normalizeRule({ courses: [] })]);
  check('空课程=全部课程', all.length === 3, all.length);
  check('按名称也能匹配', W.targetCourses(state, [W.normalizeRule({ courses: ['design'] })]).length === 1);
  check('courseMatches 空列表恒真', W.courseMatches({ courses: [] }, state.courses.a) === true);
}

console.log('[4] 采集比对（注入假 Canvas）');
const oldIso = new Date(Date.now() - 30 * 86400000).toISOString();
const freshIso = new Date(Date.now() - 5 * 60000).toISOString();

function fakeCanvas(payload) {
  return {
    calls: [],
    async list(apiPath, params) {
      this.calls.push(apiPath);
      if (apiPath.includes('/assignments')) return payload.assignments || [];
      if (apiPath.includes('/quizzes')) return payload.quizzes || [];
      if (apiPath.includes('/announcements')) return payload.announcements || [];
      return [];
    },
  };
}
const state1 = { courses: { a: { id: 1, code: 'DSC6018', name: 'Health', folder: '6018 health' } } };

{
  const doc = W.emptyDoc();
  doc.rules = [W.normalizeRule({ label: '测试', courses: ['6018'], days: [], start: '', end: '', intervalSec: 60 })];
  const seen = { items: {}, seededAt: null };
  const now = new Date();
  // 第一次扫描：库里已有一门「老」作业 + 一条 5 分钟前刚建的新 quiz
  const canvas = fakeCanvas({
    assignments: [{ id: 11, name: 'Assignment 1', due_at: '2026-10-01T15:59:00Z', created_at: oldIso, updated_at: oldIso, html_url: 'u11' }],
    quizzes: [{ id: 77, title: 'Pop Quiz', due_at: null, created_at: freshIso, updated_at: freshIso, html_url: 'u77' }],
    announcements: [{ id: 5, title: '明天带电脑', posted_at: freshIso }],
  });
  const r1 = await W.scanOnce({ canvas, state: state1, doc, seen, now, logFn: () => {} });
  check('首次扫描：老作业静默建基线', !r1.hits.some((h) => h.title === 'Assignment 1'), r1.hits.map((h) => h.title));
  check('首次扫描：1 小时内新建的 quiz 仍然提醒', r1.hits.some((h) => h.title === 'Pop Quiz' && h.kind === 'new'), r1.hits.map((h) => [h.title, h.kind]));
  check('quiz 优先级高于普通作业', (r1.hits.find((h) => h.title === 'Pop Quiz') || {}).priority >= 3);
  check('首次扫描：新公告也会提醒', r1.hits.some((h) => h.title === '明天带电脑' && h.kind === 'new'), r1.hits.map((h) => h.title));

  // 第二次扫描：内容不变 -> 不应重复提醒
  const r2 = await W.scanOnce({ canvas, state: state1, doc, seen, now, logFn: () => {} });
  check('无变化时零命中（不重复打扰）', r2.hits.length === 0, r2.hits);

  // 第三次扫描：新增一条作业 + 给 quiz 补上截止时间
  const canvas3 = fakeCanvas({
    assignments: [
      { id: 11, name: 'Assignment 1', due_at: '2026-10-01T15:59:00Z', created_at: oldIso, updated_at: oldIso },
      { id: 12, name: '课堂小测（新增）', due_at: '2026-09-15T15:59:00Z', created_at: freshIso, updated_at: freshIso },
    ],
    quizzes: [{ id: 77, title: 'Pop Quiz', due_at: '2026-09-15T08:00:00Z', created_at: freshIso, updated_at: freshIso }],
    announcements: [{ id: 5, title: '明天带电脑', posted_at: freshIso }],
  });
  const r3 = await W.scanOnce({ canvas: canvas3, state: state1, doc, seen, now, logFn: () => {} });
  check('新增作业被识别', r3.hits.some((h) => h.title === '课堂小测（新增）'), r3.hits.map((h) => h.title));
  check('quiz 补上截止时间算「变动」', r3.hits.some((h) => h.title === 'Pop Quiz' && h.kind === 'changed'), r3.hits.map((h) => [h.title, h.kind]));
  check('变动命中优先级更高', (r3.hits.find((h) => h.kind === 'changed') || {}).priority >= 4);
  check('已见过的公告不再命中', !r3.hits.some((h) => h.title === '明天带电脑'), r3.hits.map((h) => h.title));
  check('命中带课程标签', r3.hits.every((h) => h.courseLabel === '6018 health'));

  // 第四次：公告首见（之前 seen 里没有 5? 有）—— 用一条全新公告验证
  const canvas4 = fakeCanvas({
    assignments: [{ id: 11, name: 'Assignment 1', due_at: '2026-10-01T15:59:00Z' }, { id: 12, name: '课堂小测（新增）', due_at: '2026-09-15T15:59:00Z' }],
    quizzes: [{ id: 77, title: 'Pop Quiz', due_at: '2026-09-15T08:00:00Z' }],
    announcements: [{ id: 6, title: '随堂测验 10 分钟后开始', posted_at: freshIso }],
  });
  const r4 = await W.scanOnce({ canvas: canvas4, state: state1, doc, seen, now, logFn: () => {} });
  check('新公告被识别为命中', r4.hits.some((h) => h.type === 'announcement' && h.title.includes('随堂测验')), r4.hits.map((h) => h.title));
}

console.log('[4b] quiz 判定与 /quizzes 404 处理（CityU 实况）');
{
  check('名字含 Quiz 的作业按 quiz 处理', W.isQuizLike({ name: 'Quiz 3' }) === true);
  check('中文「随堂测验」按 quiz 处理', W.isQuizLike({ name: '随堂测验' }) === true);
  check('带 quiz_id 按 quiz 处理', W.isQuizLike({ name: 'X', quiz_id: 9 }) === true);
  check('普通作业不是 quiz', W.isQuizLike({ name: 'Assignment 1' }) === false);

  const doc = W.emptyDoc();
  doc.rules = [W.normalizeRule({ label: 'q', courses: [], days: [], start: '', end: '', intervalSec: 60 })];
  const seen = { items: {}, seededAt: Date.now() };
  // 模拟 CityU：/quizzes 返回 404「页面已禁用」，测验以作业形式出现
  const canvas = {
    async list(apiPath) {
      if (apiPath.includes('/quizzes')) { const e = new Error('HTTP 404 Not Found [/q]: {"message":"That page has been disabled for this course"}'); e.status = 404; throw e; }
      if (apiPath.includes('/assignments')) return [{ id: 101, name: 'Quiz 9（随堂）', due_at: '2026-09-20T15:59:00Z', created_at: new Date(Date.now() - 60000).toISOString() }];
      return [];
    },
  };
  const r = await W.scanOnce({ canvas, state: state1, doc, seen, now: new Date(), logFn: () => {} });
  check('404 的 /quizzes 不再计入错误', r.errors.length === 0, r.errors);
  check('以作业形式出现的测验被判为 quiz', r.hits.some((h) => h.type === 'quiz'), r.hits.map((h) => [h.title, h.type]));
  check('记住该课程不提供 /quizzes', seen.quizDisabled && seen.quizDisabled['1'] === true, seen.quizDisabled);
}

console.log('[5] 重复提醒判定');
{
  const rule = W.normalizeRule({ repeatMinutes: 5, maxRepeats: 2 });
  const now = Date.now();
  const p = { acked: false, alertsSent: 1, lastSentAt: now - 6 * 60000 };
  check('到点应重复', W.repeatDue(p, rule, now) === true);
  check('未到点不重复', W.repeatDue({ ...p, lastSentAt: now - 60000 }, rule, now) === false);
  check('已确认不重复', W.repeatDue({ ...p, acked: true }, rule, now) === false);
  check('超过次数上限不重复', W.repeatDue({ ...p, alertsSent: 3 }, rule, now) === false);
  check('关掉重复间隔则不重复', W.repeatDue(p, W.normalizeRule({ repeatMinutes: 0 }), now) === false);
}

console.log('[6] 规则持久化（隔离到临时目录）');
{
  const doc = W.emptyDoc();
  doc.rules = [W.normalizeRule({ label: '持久化测试', courses: ['5002'] })];
  W.saveDoc(doc);
  const back = W.loadDoc();
  check('保存后可读回', back.rules.length === 1 && back.rules[0].label === '持久化测试');
  const seen = { items: { 'x:1:1': { at: Date.now(), title: 't' } }, seededAt: Date.now() };
  W.saveSeen(seen);
  check('seen 可读回', !!W.loadSeen().items['x:1:1']);
  const st = W.watchStatus(new Date());
  check('watchStatus 结构完整', st.total === 1 && Array.isArray(st.rules) && Array.isArray(st.pending) && Array.isArray(st.hits), { total: st.total });
  check('watchStatus 带规则描述', typeof st.rules[0].description === 'string' && st.rules[0].description.length > 0, st.rules[0].description);
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
console.log('');
console.log('盯防自检：通过 ' + pass + ' / ' + (pass + fail));
if (fail) { console.log('失败项：' + failures.join('、')); process.exit(1); }
