import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const e = process.env;

const larkOn = e.LARK === '1';
// 桌面通知开关：新变量 ENABLE_DESKTOP，兼容旧的 ENABLE_MACOS / MACOS；
// 三者都没有时默认开启（安装向导总会显式传值）
const desktopRaw = e.ENABLE_DESKTOP != null && e.ENABLE_DESKTOP !== ''
  ? e.ENABLE_DESKTOP
  : (e.ENABLE_MACOS != null && e.ENABLE_MACOS !== '' ? e.ENABLE_MACOS : e.MACOS);
const desktopOn = desktopRaw !== '0';
const cfgPath = path.join(ROOT, 'config.json');
let prev = {};
try { prev = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) || {}; } catch {}
const cfg = {
  canvas: { baseUrl: e.CANVAS_URL || 'https://canvas.cityu.edu.hk', tokenFile: 'secrets.json', timeoutMs: 30000 },
  lark: {},
  channels: { desktop: desktopOn, macos: desktopOn, larkIM: larkOn, larkBase: larkOn, larkCalendar: larkOn, dashboard: true },
  web: { port: Number(e.PORT || 8788), lang: e.WEB_LANG === 'en' ? 'en' : 'zh' },
  download: { root: e.FILES_DIR || path.join(process.env.HOME || '', 'Desktop', 'CityU 课程'), maxFileSizeMB: 300, addWeekPrefix: false },
  courses: { include: [], exclude: e.CANVAS_EXCLUDE ? e.CANVAS_EXCLUDE.split(',') : [], names: {} },
  remind: { dueLeadHours: [72, 24] },
  grades: { targetPercent: Number(e.TARGET_PERCENT || 60) },
  schedule: { morning: e.MORNING || '08:00', evening: e.EVENING || '20:00' },
  classify: {
    '讲义': ['slide', 'lecture', 'notes', '课件', '讲义'],
    '作业': ['assignment', 'homework', 'hw', 'lab', 'quiz', 'project', '作业'],
    '阅读': ['reading', 'chapter', 'paper', 'reference', 'book', '阅读'],
  },
};
if (larkOn && e.LARK_CLI) cfg.lark.cli = e.LARK_CLI;
if (larkOn && e.LARK_OPEN_ID) cfg.lark.userOpenId = e.LARK_OPEN_ID;

// 重新安装时保留已有配置中「安装向导没问」的部分（飞书授权信息、课程文件夹名映射、自定义分类规则等）
if (prev.lark && Object.keys(prev.lark).length) cfg.lark = { ...prev.lark, ...cfg.lark };
if (prev.courses && prev.courses.names && Object.keys(prev.courses.names).length) cfg.courses.names = prev.courses.names;
if (prev.courses && Array.isArray(prev.courses.include) && prev.courses.include.length) cfg.courses.include = prev.courses.include;
if (prev.classify && e.KEEP_CLASSIFY !== '0') cfg.classify = prev.classify;
if (prev.grades && prev.grades.targetPercent != null && !e.TARGET_PERCENT) cfg.grades.targetPercent = prev.grades.targetPercent;
if (prev.web && prev.web.lang && !e.WEB_LANG) cfg.web.lang = prev.web.lang;

fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
fs.writeFileSync(path.join(ROOT, 'secrets.json'), JSON.stringify({ canvasToken: e.CANVAS_TOKEN || '' }, null, 2));
try { fs.chmodSync(path.join(ROOT, 'secrets.json'), 0o600); } catch {}

const settingsPath = path.join(ROOT, 'data', 'settings.json');
fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
let cur = {};
try { cur = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) || {}; } catch {}
if (e.DEEPSEEK_KEY) cur.deepseekApiKey = e.DEEPSEEK_KEY;
cur.model = cur.model || 'deepseek-chat';
fs.writeFileSync(settingsPath, JSON.stringify(cur, null, 2));
try { fs.chmodSync(settingsPath, 0o600); } catch {}

fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
console.log('已写入 config.json / secrets.json / data/settings.json');
console.log('资料目录：' + cfg.download.root);
