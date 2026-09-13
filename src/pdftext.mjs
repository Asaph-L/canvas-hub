import fs from 'node:fs';
import zlib from 'node:zlib';

// 零依赖 PDF 文字提取：解析内容流并抽取字符串（Tj / TJ 操作符）。
// 目标不是完美排版，而是把大纲里的关键词与百分比读出来（Windows / Linux 没有 Spotlight，必须自带）。

const COMMON_SHORT = new Set(['a', 'an', 'am', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'hi', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to', 'up', 'us', 'we', 'id', 'ok', 'vs', 'per', 'via', 'the', 'and', 'for', 'are', 'was', 'not', 'you', 'all', 'any', 'can', 'has', 'how', 'its', 'may', 'new', 'one', 'our', 'out', 'see', 'use', 'who', 'why', 'two', 'max', 'min', 'sum', 'lab', 'mid', 'due', 'day', 'week', 'exam', 'quiz', 'gpa', 'pdf', 'app']);

const PDF_ESCAPES = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };

function decodeLiteralString(raw) {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\') { out += ch; continue; }
    const next = raw[++i];
    if (next === undefined) break;
    if (PDF_ESCAPES[next] !== undefined) { out += PDF_ESCAPES[next]; continue; }
    if (next >= '0' && next <= '7') {
      let oct = next;
      while (oct.length < 3 && raw[i + 1] >= '0' && raw[i + 1] <= '7') oct += raw[++i];
      out += String.fromCharCode(parseInt(oct, 8));
      continue;
    }
    if (next === '\n') continue;
    out += next;
  }
  return out;
}

function decodeHexString(hex) {
  const clean = hex.replace(/[^0-9A-Fa-f]/g, '');
  const bytes = [];
  for (let i = 0; i + 1 < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16));
  if (!bytes.length) return '';
  let nulOdd = 0;
  for (let i = 0; i < bytes.length; i += 2) if (bytes[i] === 0) nulOdd++;
  if (bytes.length % 2 === 0 && nulOdd > bytes.length / 4) {
    let s = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return s;
  }
  return Buffer.from(bytes).toString('latin1');
}

function printableRatio(s) {
  if (!s.length) return 0;
  let ok = 0;
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127)) ok++;
  }
  return ok / s.length;
}

export function decodeContentStream(content) {
  const pieces = [];
  const re = /\((?:\\.|[^()\\])*\)|<[0-9A-Fa-f\s]+>/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const token = m[0];
    const text = token[0] === '(' ? decodeLiteralString(token.slice(1, -1)) : decodeHexString(token.slice(1, -1));
    if (text && printableRatio(text) > 0.8) pieces.push(text);
  }
  return pieces.join(' ').replace(/\s+/g, ' ').trim();
}

// PDF 逐字排版会把单词拆成单字母片段（"We i gh t"）；这里按「短片段粘合」还原，
// 但保留常见英文短词，避免把 "in the" 粘成 "inthe"。
export function compactText(text) {
  const cleaned = String(text)
    .replace(/\ben-[A-Z]{2}\b/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = cleaned.split(' ');
  const out = [];
  let buf = '';
  for (const tok of tokens) {
    const bare = tok.replace(/[^A-Za-z]/g, '').toLowerCase();
    const isShort = bare.length > 0 && bare.length <= 2;
    const isRealWord = COMMON_SHORT.has(bare);
    const fragment = isShort && !isRealWord;
    if (fragment) { buf += tok; continue; }
    if (buf) { out.push(buf); buf = ''; }
    out.push(tok);
  }
  if (buf) out.push(buf);
  return out.join(' ');
}

export function extractPdfText(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch { return ''; }
  const chunks = [];
  let idx = 0;
  for (let guard = 0; guard < 5000; guard++) {
    const s = buf.indexOf('stream', idx);
    if (s < 0) break;
    let start = s + 6;
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;
    const e = buf.indexOf('endstream', start);
    if (e < 0) break;
    let data = buf.subarray(start, e);
    const dictStart = buf.lastIndexOf('<<', s);
    const dict = dictStart >= 0 ? buf.subarray(dictStart, s).toString('latin1') : '';
    if (/FlateDecode/i.test(dict)) {
      try { data = zlib.inflateSync(data); }
      catch {
        try { data = zlib.inflateRawSync(data); } catch { data = null; }
      }
    }
    if (data && data.length) {
      const text = decodeContentStream(data.toString('latin1'));
      if (text && text.length > 20) chunks.push(text);
    }
    idx = e + 9;
  }
  return chunks.join('\n');
}

// 组合入口：返回「紧凑版 + 原始版」两份文本
export function readPdf(file) {
  const raw = extractPdfText(file);
  if (!raw) return null;
  return { text: compactText(raw), raw };
}
