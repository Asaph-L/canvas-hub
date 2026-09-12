import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './util.mjs';

function readConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')); } catch { return {}; }
}

export function larkBin() {
  const cfg = readConfig();
  const c = cfg.lark && cfg.lark.cli ? String(cfg.lark.cli) : '';
  if (c && fs.existsSync(c)) return c;
  if (fs.existsSync('/opt/homebrew/bin/lark-cli')) return '/opt/homebrew/bin/lark-cli';
  const which = spawnSync('bash', ['-lc', 'command -v lark-cli'], { encoding: 'utf8' });
  const found = (which.stdout || '').trim();
  return found || 'lark-cli';
}

export function larkUserOpenId() {
  const cfg = readConfig();
  return (cfg.lark && cfg.lark.userOpenId) || '';
}

export function larkEnabled() {
  const cfg = readConfig();
  const ch = cfg.channels || {};
  return !!(ch.larkIM || ch.larkBase || ch.larkCalendar);
}

export function lark(args, { timeout = 120000 } = {}) {
  const r = spawnSync(larkBin(), args, {
    encoding: 'utf8',
    timeout,
    env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' },
  });
  const raw = (r.stdout || '').trim();
  let json = null;
  const i = raw.indexOf('{');
  if (i >= 0) {
    try { json = JSON.parse(raw.slice(i)); } catch {}
  }
  const err = (r.stderr || '').trim();
  return { code: r.status, ok: json?.ok === true, json, raw, err };
}

export function larkStatus() {
  const r = lark(['auth', 'status', '--json', '--verify'], { timeout: 60000 });
  const u = r.json && r.json.identities && r.json.identities.user;
  return {
    reachable: !!r.json,
    userReady: !!(u && u.status === 'ready'),
    userName: (u && u.userName) || '',
    openId: (u && u.openId) || '',
    bin: larkBin(),
  };
}
