import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

export function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  const tokenFile = path.resolve(ROOT, cfg.canvas?.tokenFile || 'secrets.json');
  if (fs.existsSync(tokenFile)) {
    const sec = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
    cfg.canvas = { ...cfg.canvas, token: sec.canvasToken };
  }
  return cfg;
}

let logStream = null;
export function initLog(tag) {
  const logsDir = path.join(ROOT, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  logStream = fs.createWriteStream(path.join(logsDir, tag + '-' + ts + '.log'), { flags: 'a' });
}
export function log(...args) {
  const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  console.log(line);
  logStream?.write(line + '\n');
}
export function closeLog() {
  logStream?.end();
  logStream = null;
}

export function sanitizeName(name) {
  let s = String(name).normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '');
  if (s.length > 120) {
    const ext = path.extname(s);
    s = s.slice(0, 120 - ext.length) + ext;
  }
  return s || 'unnamed';
}

export function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

export function listDirs(p) {
  try { return fs.readdirSync(p, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); }
  catch { return []; }
}

export function deriveShortName(name, codes) {
  const list = Array.isArray(codes) ? codes : [codes];
  let n = String(name || '');
  for (const code of list) {
    if (!code) continue;
    n = n.replace(new RegExp(String(code).replace(/[.*+?^\${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
  }
  n = n
    .replace(/\([^)]*(semester|term|session|academic)[^)]*\)/gi, ' ')
    .replace(/\b(semester|term|session|academic year)\s*[a-z]?\s*[\d/ -]{2,}/gi, ' ')
    .replace(/\b\d{4}\s*\/\s*\d{2,4}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const stop = new Set(['and', 'of', 'for', 'the', 'in', 'a', 'an', '&']);
  const words = n.split(' ').filter(w => w && !stop.has(w));
  const short = words.slice(0, 2).join(' ');
  return short || String(list[0] || '').toLowerCase() || 'course';
}

export function hkTime(iso) {
  try {
    return new Date(iso).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return String(iso); }
}
