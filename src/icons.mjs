// 应用图标：纯 Node 生成 PNG（零依赖，仓库里不放二进制）
// 设计：蓝色渐变圆角方块 + 白色 "C"（course / canvas），maskable 变体留出安全区。

import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

export function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const src = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length);
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    src.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function inRoundedRect(x, y, size, radius) {
  if (x < 0 || y < 0 || x > size || y > size) return false;
  if (radius <= 0) return true;
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function lerp(a, b, t) { return a + (b - a) * t; }

/** 返回单个采样点的 RGBA（归一化坐标 0..1） */
function sample(x, y, { maskable, opaque }) {
  const radius = opaque ? 0 : 0.225;
  if (!inRoundedRect(x, y, 1, radius)) return null;

  // 背景：垂直渐变 #3b82f6 -> #1d4ed8
  const t = Math.min(1, Math.max(0, y));
  const bg = [
    Math.round(lerp(59, 29, t)),
    Math.round(lerp(130, 78, t)),
    Math.round(lerp(246, 216, t)),
    255,
  ];

  const ringR = maskable ? 0.185 : 0.225;
  const thick = maskable ? 0.085 : 0.105;
  const dx = x - 0.5, dy = y - 0.5;
  const d = Math.sqrt(dx * dx + dy * dy);
  const ang = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);

  // C 形：右侧留 84° 开口
  if (ang > 42 && Math.abs(d - ringR) <= thick / 2) return [255, 255, 255, 255];
  return bg;
}

/** 2x 超采样抗锯齿 */
export function renderIcon(size, { maskable = false, opaque = false } = {}) {
  const ss = 2;
  const big = size * ss;
  const acc = new Float64Array(size * size * 4);
  for (let sy = 0; sy < big; sy++) {
    const y = (sy + 0.5) / big;
    for (let sx = 0; sx < big; sx++) {
      const x = (sx + 0.5) / big;
      const c = sample(x, y, { maskable, opaque });
      if (!c) continue;
      const di = (Math.floor(sy / ss) * size + Math.floor(sx / ss)) * 4;
      acc[di] += c[0]; acc[di + 1] += c[1]; acc[di + 2] += c[2]; acc[di + 3] += c[3];
    }
  }
  const n = ss * ss;
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    for (let k = 0; k < 4; k++) out[i * 4 + k] = Math.round(acc[i * 4 + k] / n);
  }
  return encodePNG(size, size, out);
}

// 运行时缓存：同一进程内只生成一次
const cache = new Map();

export function iconFor(kind) {
  if (cache.has(kind)) return cache.get(kind);
  let buf;
  if (kind === '192') buf = renderIcon(192, {});
  else if (kind === '512') buf = renderIcon(512, {});
  else if (kind === 'maskable') buf = renderIcon(512, { maskable: true, opaque: true });
  else if (kind === 'apple') buf = renderIcon(180, { opaque: true });
  else if (kind === 'favicon') buf = renderIcon(64, {});
  else return null;
  cache.set(kind, buf);
  return buf;
}

export const MANIFEST = {
  name: 'canvas-hub 课程看板',
  short_name: 'canvas-hub',
  description: '城市大学课程资料 · 日程 · 离线看板',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait-primary',
  background_color: '#0f1115',
  theme_color: '#2563eb',
  lang: 'zh-CN',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  shortcuts: [
    { name: '日历', short_name: '日历', url: '/?tab=calendar' },
    { name: '对话', short_name: '对话', url: '/?tab=chat' },
  ],
};
