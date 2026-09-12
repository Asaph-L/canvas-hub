import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from './util.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Canvas {
  constructor({ baseUrl, token, timeoutMs = 30000, minIntervalMs = 200 }) {
    this.base = String(baseUrl || '').replace(/\/+$/, '');
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.minIntervalMs = minIntervalMs;
    this.lastAt = 0;
  }

  async #pace() {
    const wait = this.lastAt + this.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastAt = Date.now();
  }

  async rawGet(url, retries = 3) {
    let lastErr;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.#pace();
        const res = await fetch(url, {
          headers: { Authorization: 'Bearer ' + this.token },
          signal: AbortSignal.timeout(this.timeoutMs),
          redirect: 'follow',
        });
        if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          const err = new Error('HTTP ' + res.status + ' ' + res.statusText + ' [' + url + ']: ' + body.slice(0, 200));
          err.status = res.status;
          throw err;
        }
        return res;
      } catch (e) {
        lastErr = e;
        if (e.status && e.status < 500 && e.status !== 429) throw e;
        if (attempt < retries) await sleep(1000 * 2 ** (attempt - 1));
      }
    }
    throw lastErr;
  }

  buildUrl(apiPath, params = {}) {
    const url = new URL(this.base + '/api/v1' + (apiPath.startsWith('/') ? apiPath : '/' + apiPath));
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      for (const one of Array.isArray(v) ? v : [v]) url.searchParams.append(k, String(one));
    }
    return url.toString();
  }

  async api(apiPath, params = {}) {
    return this.rawGet(this.buildUrl(apiPath, params));
  }

  async list(apiPath, params = {}) {
    const out = [];
    let url = this.buildUrl(apiPath, params);
    while (url) {
      const res = await this.rawGet(url);
      out.push(...(await res.json()));
      const link = res.headers.get('link') || '';
      const m = /<([^>]+)>\s*;\s*rel="next"/.exec(link);
      url = m ? m[1] : null;
    }
    return out;
  }

  async downloadTo(fileUrl, dest) {
    const res = await this.rawGet(fileUrl, 2);
    const buf = Buffer.from(await res.arrayBuffer());
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, buf);
  }
}
