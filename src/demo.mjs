import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadConfig, log } from './util.mjs';

const DAY = 86400000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString();
const hk = (offsetDays, hour, minute) => {
  const d = new Date(Date.now() + offsetDays * DAY);
  d.setHours(hour || 23, minute || 59, 0, 0);
  return d.toISOString();
};

const DEMO_COURSES = [
  { code: 'DEMO1001', folder: 'DEMO-1001 机器学习导论', name: 'DEMO1001 Introduction to Machine Learning' },
  { code: 'DEMO2002', folder: 'DEMO-2002 数据可视化', name: 'DEMO2002 Data Visualization' },
  { code: 'DEMO3003', folder: 'DEMO-3003 实验设计', name: 'DEMO3003 Design of Experiments' },
];

const DEMO_FILES = [
  ['DEMO-1001 机器学习导论', '讲义', 'week1-introduction.md', 14200],
  ['DEMO-1001 机器学习导论', '讲义', 'week2-regression.md', 23800],
  ['DEMO-1001 机器学习导论', '阅读', 'reading-linear-algebra.md', 9800],
  ['DEMO-2002 数据可视化', '讲义', 'week1-grammar-of-graphics.md', 17600],
  ['DEMO-2002 数据可视化', '作业', 'assignment1-brief.md', 4200],
  ['DEMO-3003 实验设计', '讲义', 'week1-doe-basics.md', 20100],
  ['DEMO-3003 实验设计', '其他', 'tutorial-setup.md', 3300],
];

function writeDemoFile(root, folder, category, name) {
  const dir = path.join(root, folder, category);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, '# 演示文件：' + name + '\n\n这是 canvas-hub 演示模式生成的占位文件，用来展示「点击文件名直达本地资料」的效果。\n\n执行 node cli.mjs demo --off 可退出演示模式。\n', 'utf8');
  }
  return path.posix.join(folder, category, name);
}

function buildDemoState(root) {
  const courses = {};
  DEMO_COURSES.forEach((c, i) => {
    const files = {};
    DEMO_FILES.filter((f) => f[0] === c.folder).forEach((f, j) => {
      const rel = writeDemoFile(root, f[0], f[1], f[2]);
      files['demo-' + i + '-' + j] = {
        name: f[2], path: rel, size: f[3], updated_at: iso(-7 + j), week: j + 1,
        category: f[1], source: 'canvas', downloadedAt: iso(-3 + j),
      };
    });
    courses['demo-' + i] = {
      id: 'demo-' + i, code: c.code, name: c.name, folder: c.folder,
      files, folders: {}, announcements: {}, baseRecordId: null,
      demo: true,
    };
  });

  const c0 = courses['demo-0'];
  c0.assignments = [
    { id: 'demo-a1', name: 'Quiz 1', due_at: hk(-2, 23, 59), points: 10, url: '', submission: { submitted_at: iso(-3), grade: '8', score: 8, missing: false } },
    { id: 'demo-a2', name: 'Assignment 1: Regression', due_at: hk(1, 23, 59), points: 100, url: '', submission: { submitted_at: null, grade: null, score: null, missing: true } },
    { id: 'demo-a3', name: 'Final Project', due_at: hk(12, 23, 59), points: 100, url: '', submission: { submitted_at: null, grade: null, score: null, missing: false } },
  ];
  c0.grades = { current_score: 78.5, final_score: null, current_grade: 'B+', final_grade: null };
  c0.assessment = {
    components: [
      { name: '平时作业', type: 'assignment', weight: 30, earnedPct: 82 },
      { name: '期中考试', type: 'exam', weight: 30, earnedPct: 75 },
      { name: '期末项目', type: 'project', weight: 40, earnedPct: null, reqIfOthersAvg: 52.5, reqIfOthersFull: 13.8 },
    ],
    passThreshold: 60, notes: '演示数据', source: 'demo', updatedAt: iso(0),
  };
  c0.safety = { earned: 47.1, gradedW: 60, remainingW: 40, currentNorm: 78.5, target: 60 };
  c0.announcements = {
    'demo-n1': { id: 'demo-n1', title: '期末项目分组已发布，请在本周内确认组队', posted_at: iso(-2), firstSeen: iso(-2) },
    'demo-n2': { id: 'demo-n2', title: '第 3 周讲义已上传', posted_at: iso(-5), firstSeen: iso(-5) },
  };

  const c1 = courses['demo-1'];
  c1.assignments = [
    { id: 'demo-b1', name: 'Assignment 1: Visualization Critique', due_at: hk(4, 23, 59), points: 100, url: '', submission: { submitted_at: null, grade: null, score: null, missing: false } },
  ];
  c1.grades = { current_score: null, final_score: null, current_grade: null, final_grade: null };
  c1.assessment = {
    components: [
      { name: '作业', type: 'assignment', weight: 40, earnedPct: null, reqIfOthersFull: 150 },
      { name: '期末项目', type: 'project', weight: 60, earnedPct: null, reqIfOthersFull: 100 },
    ],
    passThreshold: 60, notes: '演示数据', source: 'demo', updatedAt: iso(0),
  };
  c1.safety = { earned: 0, gradedW: 0, remainingW: 100, currentNorm: null, target: 60 };

  const c2 = courses['demo-2'];
  c2.assignments = [
    { id: 'demo-c1', name: 'Lab Report 1', due_at: hk(8, 23, 59), points: 50, url: '', submission: { submitted_at: null, grade: null, score: null, missing: false } },
  ];
  c2.grades = { current_score: null, final_score: null, current_grade: null, final_grade: null };
  c2.assessment = null;
  c2.safety = null;

  return {
    syncedAt: new Date().toISOString(),
    baseUrl: '',
    demo: true,
    courses,
  };
}

export async function demo({ off = false } = {}) {
  const cfg = loadConfig();
  const root = path.resolve(ROOT, cfg.download?.root || '..');
  const statePath = path.join(ROOT, 'data', 'state.json');
  const bakPath = path.join(ROOT, 'data', 'state.json.bak');
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });

  if (off) {
    if (fs.existsSync(bakPath)) {
      fs.renameSync(bakPath, statePath);
      log('✅ 已退出演示模式，真实数据已恢复（data/state.json.bak → state.json）');
    } else if (fs.existsSync(statePath)) {
      const cur = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (cur.demo) { fs.unlinkSync(statePath); log('✅ 已退出演示模式并移除演示数据'); }
      else log('ℹ️ 当前不是演示数据，未做改动');
    }
    log('   可运行 node cli.mjs sync 重新同步真实数据');
    return;
  }

  if (fs.existsSync(statePath)) {
    const cur = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (cur.demo) { log('ℹ️ 当前已是演示模式'); }
    else if (!fs.existsSync(bakPath)) {
      fs.copyFileSync(statePath, bakPath);
      log('ℹ️ 已把真实数据备份到 data/state.json.bak');
    }
  }
  fs.writeFileSync(statePath, JSON.stringify(buildDemoState(root), null, 2));
  log('✅ 演示数据已就绪（3 门假课程 / 5 个作业 / 成绩与安全线示例）');
  log('   资料目录：' + root);
  log('   查看：打开网页看板，或运行 node cli.mjs dashboard');
  log('   退出演示：node cli.mjs demo --off');
}
