// 局域网访问：地址探测、访问令牌、证书分发
//
// 设计要点
//  - 桌面（localhost）永远免令牌：本机就是可信边界。
//  - 手机走 HTTPS + 访问令牌；令牌只在「本机」接口里展示，绝不出局域网。
//  - 因为自签证书在手机上必须先安装才被信任，所以额外开一个「纯 HTTP 助手端口」，
//    只暴露 /ca.crt /ca.cer /ca.mobileconfig 和一张安装说明页，其余一律 403。

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isPrivateIPv4 } from './cert.mjs';

export function lanHosts() {
  const found = [];
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces || {})) {
    for (const a of addrs || []) {
      if (a.internal || a.family !== 'IPv4') continue;
      if (isPrivateIPv4(a.address) && a.address !== '169.254.0.0') {
        found.push({ address: a.address, iface: name });
      }
    }
  }
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  const seen = new Set();
  return found
    .filter((x) => (seen.has(x.address) ? false : (seen.add(x.address), true)))
    .sort((a, b) => rank(a.address) - rank(b.address) || a.address.localeCompare(b.address));
}

export function normalizeAddr(addr) {
  return String(addr || '').replace(/^::ffff:/, '');
}

export function isLoopback(addr) {
  const a = normalizeAddr(addr);
  return a === '127.0.0.1' || a === '::1' || a === 'localhost';
}

export function isLocalNetwork(addr) {
  const a = normalizeAddr(addr);
  if (isLoopback(a)) return true;
  return isPrivateIPv4(a);
}

// ---------------- 访问令牌 ----------------

function tokenPath(dataDir) {
  return path.join(dataDir, 'lan-token.txt');
}

export function ensureToken(dataDir) {
  const p = tokenPath(dataDir);
  try {
    const t = fs.readFileSync(p, 'utf8').trim();
    if (/^[0-9a-f]{32}$/.test(t)) return t;
  } catch {}
  return regenerateToken(dataDir);
}

export function regenerateToken(dataDir) {
  const t = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(tokenPath(dataDir), t + '\n', { mode: 0o600 });
  return t;
}

export function tokenMatches(provided, expected) {
  if (!provided || !expected) return false;
  const a = crypto.createHash('sha256').update(String(provided)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

/** 从 Cookie / 查询串 / 请求头里取令牌 */
export function tokenFromRequest(req, url) {
  const cookie = req.headers.cookie || '';
  const m = /(?:^|;\s*)chub_token=([0-9a-f]{32})/.exec(cookie);
  if (m) return m[1];
  const q = url.searchParams.get('t');
  if (q) return q;
  const h = req.headers['x-canvas-hub-token'];
  if (h) return String(h);
  const auth = req.headers.authorization || '';
  const b = /^Bearer\s+(.+)$/i.exec(auth);
  if (b) return b[1].trim();
  return '';
}

// ---------------- 证书分发 ----------------

export function pemToDer(pem) {
  const b64 = String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Buffer.from(b64, 'base64');
}

/** iOS 配置描述文件：一次点击即可安装根证书，比 .crt 更可靠 */
export function mobileConfig(caDer, hosts) {
  const uuid = () => crypto.randomUUID().toUpperCase();
  const name = 'canvas-hub Local CA';
  const b64 = caDer.toString('base64').replace(/(.{64})/g, '$1\n').trim();
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>PayloadContent</key>',
    '  <array>',
    '    <dict>',
    '      <key>PayloadCertificateFileName</key>',
    '      <string>canvas-hub-ca.crt</string>',
    '      <key>PayloadContent</key>',
    '      <data>' + b64 + '</data>',
    '      <key>PayloadDescription</key>',
    '      <string>canvas-hub 本地根证书（用于信任手机端离线看板）</string>',
    '      <key>PayloadDisplayName</key>',
    '      <string>' + name + '</string>',
    '      <key>PayloadIdentifier</key>',
    '      <string>local.canvas-hub.ca</string>',
    '      <key>PayloadType</key>',
    '      <string>com.apple.security.root</string>',
    '      <key>PayloadUUID</key>',
    '      <string>' + uuid() + '</string>',
    '      <key>PayloadVersion</key>',
    '      <integer>1</integer>',
    '    </dict>',
    '  </array>',
    '  <key>PayloadDisplayName</key>',
    '  <string>canvas-hub 手机看板</string>',
    '  <key>PayloadIdentifier</key>',
    '  <string>local.canvas-hub.profile</string>',
    '  <key>PayloadRemovalDisallowed</key>',
    '  <false/>',
    '  <key>PayloadType</key>',
    '  <string>Configuration</string>',
    '  <key>PayloadUUID</key>',
    '  <string>' + uuid() + '</string>',
    '  <key>PayloadVersion</key>',
    '  <integer>1</integer>',
    '</dict>',
    '</plist>',
    '',
  ];
  return lines.join('\n');
}

/** 助手端口上的安装说明页（手机浏览器打开，指导装证书 + 扫码/点链接进看板） */
export function helperPage({ httpsUrl, hosts, port }) {
  const host = hosts[0] || '127.0.0.1';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = [];
  html.push('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">');
  html.push('<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">');
  html.push('<title>canvas-hub 手机看板 · 安装</title>');
  html.push('<style>');
  html.push(':root{color-scheme:light dark}body{font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;margin:0;padding:24px;max-width:640px;margin:0 auto;background:#f7f7f8;color:#18181b}');
  html.push('@media(prefers-color-scheme:dark){body{background:#0f1115;color:#e8e8ea}.card{background:#1a1d24!important;border-color:#2a2f3a!important}a.btn{background:#3b82f6!important;color:#fff!important}}');
  html.push('.card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:18px 20px;margin:14px 0}');
  html.push('h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:0 0 8px;opacity:.75;font-weight:600}');
  html.push('a.btn{display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:11px 18px;border-radius:10px;font-weight:600;margin:6px 10px 6px 0}');
  html.push('code{background:rgba(127,127,127,.14);padding:2px 6px;border-radius:6px;font-size:14px;word-break:break-all}');
  html.push('ol{padding-left:22px}li{margin:6px 0}.muted{opacity:.65;font-size:14px}');
  html.push('</style></head><body>');
  html.push('<h1>canvas-hub 手机看板</h1>');
  html.push('<p class="muted">本机局域网地址：<code>' + esc(host) + '</code> · 助手端口 ' + esc(port) + '</p>');
  html.push('<div class="card"><h2>第一步 · 安装本地根证书</h2>');
  html.push('<p>手机离线看板必须走 HTTPS。本机使用自签证书，需要先把根证书装进手机（只做一次，之后换 WiFi 也不用重装）。</p>');
  html.push('<a class="btn" href="/ca.mobileconfig">iPhone / iPad（推荐）</a>');
  html.push('<a class="btn" href="/ca.crt">Android / 通用 .crt</a>');
  html.push('<p class="muted">iPhone：下载后到「设置 → 已下载描述文件」安装，再到「设置 → 通用 → 关于本机 → 证书信任设置」打开完全信任。</p>');
  html.push('<p class="muted">Android：设置 → 安全 → 加密与凭据 → 安装证书 → CA 证书，选择刚下载的文件。</p>');
  html.push('</div>');
  html.push('<div class="card"><h2>第二步 · 打开看板</h2>');
  html.push('<p>安装证书后，回到<strong>电脑上的看板</strong> → 「设置 → 手机配对」→ 用手机扫那里的二维码。</p>');
  html.push('<p class="muted">二维码里带着访问令牌，扫一次即自动记住，之后换 WiFi 也不用重扫。令牌只显示在电脑屏幕上，不会从这个页面泄露。</p>');
  html.push('<p>想先确认证书装好了？点这个（不带令牌，若证书已信任会进入看板的配对提示页）：</p>');
  html.push('<a class="btn" href="' + esc(httpsUrl) + '/">测试 HTTPS 连接</a>');
  html.push('</div>');
  html.push('<div class="card"><h2>第三步 · 装到桌面（可选）</h2>');
  html.push('<p class="muted">iPhone：Safari 分享 → 添加到主屏幕。Android：Chrome 菜单 → 安装应用 / 添加到主屏幕。之后即可离线打开看板，查看最近一次同步的课程状态。</p>');
  html.push('</div>');
  html.push('</body></html>');
  return html.join('\n');
}
