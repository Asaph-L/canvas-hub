// PWA / 局域网自检（零依赖，可进 CI）
//
// 覆盖：PWA 资源、localhost 免令牌、局域网令牌鉴权、扫码 Cookie 流、
//       证书分发、助手端口不泄露令牌。
// 用法：node scripts/selftest-pwa.mjs

import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/util.mjs';
import { lanHosts } from '../src/lan.mjs';

const PORT = 8911;
const LAN_PORT = 8912;
const HELPER_PORT = 8913;

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (detail ? ' → ' + detail : '')); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(url, { method = 'GET', headers = {}, agent } = {}) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method,
      headers,
      rejectUnauthorized: false,
      timeout: 8000,
    }, (res) => {
      const chunks = [];
      res.on('data', (d) => { chunks.push(d); });
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, raw, body: raw.toString('utf8') });
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: String(e.message), headers: {}, body: '', raw: Buffer.alloc(0) }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout', headers: {}, body: '', raw: Buffer.alloc(0) }); });
    req.end();
  });
}

const child = spawn(process.execPath, ['server.mjs'], {
  cwd: ROOT,
  env: { ...process.env, CANVAS_HUB_PORT: String(PORT), CANVAS_HUB_LAN_PORT: String(LAN_PORT), CANVAS_HUB_HELPER_PORT: String(HELPER_PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });

function cleanup() {
  try { child.kill('SIGKILL'); } catch {}
}
process.on('exit', cleanup);

// 等待服务就绪
let ready = false;
for (let i = 0; i < 40; i++) {
  await sleep(250);
  const r = await request('http://127.0.0.1:' + PORT + '/api/health');
  if (r.status === 200) { ready = true; break; }
}
if (!ready) {
  console.log('服务未能启动，日志：');
  console.log(serverLog.slice(0, 2000));
  process.exit(1);
}

const token = fs.readFileSync(path.join(ROOT, 'data', 'lan-token.txt'), 'utf8').trim();

console.log('[1] 本地（localhost）免令牌');
{
  const health = await request('http://127.0.0.1:' + PORT + '/api/health');
  check('GET /api/health → 200', health.status === 200, 'status=' + health.status);
  check('health 带版本号', /"version":"[^"]+"/.test(health.body));
  const state = await request('http://127.0.0.1:' + PORT + '/api/state');
  check('GET /api/state 无需令牌 → 200', state.status === 200, 'status=' + state.status);
  check('state 标记 local:true', /"local":true/.test(state.body));
}

console.log('[2] PWA 资源');
{
  const sw = await request('http://127.0.0.1:' + PORT + '/sw.js');
  check('GET /sw.js → 200', sw.status === 200);
  check('sw.js 含 stale-while-revalidate 逻辑', sw.body.includes('stateStaleWhileRevalidate'));
  const mf = await request('http://127.0.0.1:' + PORT + '/manifest.webmanifest');
  let manifest = null;
  try { manifest = JSON.parse(mf.body); } catch {}
  check('GET /manifest.webmanifest → 200 JSON', mf.status === 200 && !!manifest);
  check('manifest 含 192/512/maskable 图标', !!manifest && ['192x192', '512x512'].every((s) => manifest.icons.some((i) => i.sizes === s)) && manifest.icons.some((i) => i.purpose === 'maskable'));
  check('manifest 指定 standalone', !!manifest && manifest.display === 'standalone');
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const icon = await request('http://127.0.0.1:' + PORT + '/icon-192.png');
  check('GET /icon-192.png → PNG', icon.status === 200 && icon.raw.subarray(0, 4).equals(pngSig), 'status=' + icon.status);
  const apple = await request('http://127.0.0.1:' + PORT + '/apple-touch-icon.png');
  check('GET /apple-touch-icon.png → PNG', apple.status === 200 && apple.raw.subarray(0, 4).equals(pngSig));
}

console.log('[3] 配对信息（仅本机）');
let pair = null;
{
  const r = await request('http://127.0.0.1:' + PORT + '/api/pair');
  try { pair = JSON.parse(r.body); } catch {}
  check('GET /api/pair → 200', r.status === 200 && !!pair);
  check('配对信息含令牌与二维码 SVG', !!pair && /^[0-9a-f]{32}$/.test(pair.token) && pair.qr.indexOf('<svg') >= 0);
  check('二维码带白底（深色主题可扫）', !!pair && pair.qr.includes('#ffffff'));
}

const hosts = lanHosts().map((h) => h.address);
const lanIp = hosts[0];

console.log('[4] 局域网 HTTPS：令牌鉴权');
if (!lanIp) {
  console.log('  ⚠️ 跳过（本机没有私有网段地址，无法模拟局域网来源）');
} else {
  const base = 'https://' + lanIp + ':' + LAN_PORT;
  const noToken = await request(base + '/api/state');
  check('无令牌 /api/state → 401', noToken.status === 401, 'status=' + noToken.status);
  const badToken = await request(base + '/api/state?t=' + 'f'.repeat(32));
  check('错误令牌 → 401', badToken.status === 401, 'status=' + badToken.status);
  const withToken = await request(base + '/api/state?t=' + token);
  check('正确令牌 → 200', withToken.status === 200, 'status=' + withToken.status);
  const shell = await request(base + '/');
  check('静态壳无需令牌 → 200', shell.status === 200, 'status=' + shell.status);
  const scan = await request(base + '/?t=' + token);
  check('扫码 URL → 302', scan.status === 302, 'status=' + scan.status);
  check('扫码后设置 HttpOnly Cookie', /chub_token=/.test(String(scan.headers['set-cookie'])) && /HttpOnly/.test(String(scan.headers['set-cookie'])));
  check('扫码后 Location 不含令牌', String(scan.headers.location) === '/', 'location=' + scan.headers.location);
  const deep = await request(base + '/?t=' + token + '&tab=set&theme=dark');
  check('深链接参数被保留', String(deep.headers.location) === '/?tab=set&theme=dark', 'location=' + deep.headers.location);
  const cookie = String(scan.headers['set-cookie'] || '').split(';')[0];
  const withCookie = await request(base + '/api/state', { headers: { Cookie: cookie } });
  check('Cookie 换令牌 → 200', withCookie.status === 200, 'status=' + withCookie.status);
}

console.log('[5] 助手端口：只发证书');
if (!lanIp) {
  console.log('  ⚠️ 跳过（同上）');
} else {
  const helperBase = 'http://' + lanIp + ':' + HELPER_PORT;
  const page = await request(helperBase + '/');
  check('安装说明页 → 200', page.status === 200, 'status=' + page.status);
  check('安装页不泄露令牌', !page.body.includes(token));
  check('安装页给出证书下载入口', page.body.includes('/ca.mobileconfig') && page.body.includes('/ca.crt'));
  const blocked = await request(helperBase + '/api/state');
  check('助手端口访问接口 → 403', blocked.status === 403, 'status=' + blocked.status);
  const crt = await request(helperBase + '/ca.crt');
  check('GET /ca.crt → PEM', crt.status === 200 && crt.body.includes('BEGIN CERTIFICATE'));
  const mc = await request(helperBase + '/ca.mobileconfig');
  check('GET /ca.mobileconfig → iOS 描述文件', mc.status === 200 && mc.body.includes('com.apple.security.root'));
}

console.log('[6] 证书文件');
{
  const tlsDir = path.join(ROOT, 'data', 'tls');
  check('生成 ca.pem / server.pem / server.key', ['ca.pem', 'server.pem', 'server.key'].every((f) => fs.existsSync(path.join(tlsDir, f))));
  const info = JSON.parse(fs.readFileSync(path.join(tlsDir, 'cert-info.json'), 'utf8'));
  check('证书 SAN 覆盖本机 IP', hosts.every((h) => info.hosts.includes(h)), JSON.stringify(info.hosts));
}

console.log('');
console.log('PWA 自检：通过 ' + pass + ' / ' + (pass + fail));
if (fail) {
  console.log('失败项：' + failures.join('、'));
  console.log('服务日志（尾部）：');
  console.log(serverLog.slice(-1500));
}
cleanup();
process.exit(fail ? 1 : 0);
