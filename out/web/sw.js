// canvas-hub 离线看板 · Service Worker
//
// 策略
//   - 应用壳（HTML/图标/清单）：缓存优先，保证离线可打开
//   - /api/state：stale-while-revalidate —— 先给缓存（瞬间出图、离线可用），后台静默更新
//   - /api/state?fresh=1：网络优先（下拉刷新/手动刷新用）
//   - 其它接口与课程文件一律直连网络，不缓存（保持"只缓存状态数据"的轻量约定）
//
// 令牌通过 Cookie 传递，缓存里只会有本机自己的数据，不会跨设备共享。

// 每次改前端（HTML/CSS/JS）都要递增：浏览器检测到 sw.js 变化才会重新安装并刷新壳缓存
const VERSION = 'chub-v2';
const SHELL = VERSION + '-shell';
const DATA = VERSION + '-data';
const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(SHELL_URLS.map((u) =>
      fetch(new Request(u, { cache: 'reload' }))
        .then((res) => (res && res.ok ? cache.put(u, res) : null))
        .catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k)));
    await self.clients.claim();
    const list = await self.clients.matchAll({ type: 'window' });
    list.forEach((c) => c.postMessage({ type: 'sw-activated', version: VERSION }));
  })());
});

function withStaleMark(hit) {
  return hit.blob().then((body) => {
    const headers = new Headers(hit.headers);
    headers.set('X-Canvas-Hub-Cache', 'stale');
    return new Response(body, { status: hit.status, statusText: hit.statusText, headers });
  });
}

async function stateStaleWhileRevalidate(request) {
  const cache = await caches.open(DATA);
  const hit = await cache.match('/api/state');
  const fresh = fetch(request).then((res) => {
    if (res && res.ok) cache.put('/api/state', res.clone());
    return res;
  });
  if (hit) {
    fresh.catch(() => {});
    return withStaleMark(hit);
  }
  try {
    return await fresh;
  } catch {
    return offlinePayload();
  }
}

async function stateNetworkFirst(request) {
  const cache = await caches.open(DATA);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put('/api/state', res.clone());
    return res;
  } catch {
    const hit = await cache.match('/api/state');
    if (hit) return withStaleMark(hit);
    return offlinePayload();
  }
}

function offlinePayload() {
  return new Response(JSON.stringify({ ok: false, offline: true, error: 'offline' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Canvas-Hub-Cache': 'miss' },
  });
}

async function shellNavigation(request) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(request);
    // 联网时顺便刷新离线副本，否则"离线兜底"会一直停留在旧版本的前端
    if (res && res.ok) cache.put('/index.html', res.clone());
    return res;
  } catch {
    const hit = (await cache.match('/index.html')) || (await cache.match('/'));
    if (hit) return hit;
    return new Response('离线且没有缓存', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res && res.ok && new URL(request.url).origin === self.location.origin) {
      cache.put(request, res.clone());
    }
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.origin !== self.location.origin) return;

  if (url.pathname === '/api/state') {
    event.respondWith(url.searchParams.has('fresh') ? stateNetworkFirst(request) : stateStaleWhileRevalidate(request));
    return;
  }
  if (url.pathname.startsWith('/api/') || url.pathname === '/files') return;
  if (request.mode === 'navigate') {
    event.respondWith(shellNavigation(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'skip-waiting') self.skipWaiting();
  if (data.type === 'clear-data') {
    event.waitUntil(caches.delete(DATA));
  }
});
