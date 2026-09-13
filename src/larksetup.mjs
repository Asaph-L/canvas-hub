import fs from 'node:fs';
import path from 'node:path';
import { ROOT, log, openPath } from './util.mjs';
import { lark, larkBin, larkStatus } from './larkrun.mjs';

function saveIdentity() {
  const st = larkStatus();
  if (!st.userReady) return;
  try {
    const p = path.join(ROOT, 'config.json');
    const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
    cfg.lark = cfg.lark || {};
    cfg.lark.cli = larkBin();
    if (st.openId) cfg.lark.userOpenId = st.openId;
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
    log('✅ 已写入 config.json：飞书 CLI 路径' + (st.openId ? ' 与 openId' : ''));
  } catch (e) { log('⚠️ 写入 config.json 失败：' + e.message); }
}

export async function larkSetup({ noWait = false, finishCode = '' } = {}) {
  const bin = larkBin();
  if (bin === 'lark-cli' && !fs.existsSync('/opt/homebrew/bin/lark-cli')) {
    log('❌ 未找到 lark-cli。请先安装：npx @larksuite/cli@latest install');
    log('   安装完成后重新运行：node cli.mjs lark-setup');
    return;
  }
  if (finishCode) {
    log('正在完成授权（device code：' + finishCode.slice(0, 12) + '…）');
    const done = lark(['auth', 'login', '--device-code', finishCode, '--json'], { timeout: 600000 });
    if (done.ok) { log('✅ 飞书授权完成'); saveIdentity(); }
    else log('❌ 授权未完成或已过期：' + (done.err || done.raw).slice(0, 300));
    return;
  }
  const st = larkStatus();
  if (st.userReady) { log('✅ 飞书用户身份已就绪：' + (st.userName || '')); saveIdentity(); log('   如需重新授权：先运行 lark-cli auth logout 再执行本命令'); return; }
  log('正在发起飞书授权（应用：' + bin + '）…');
  const r = lark(['auth', 'login', '--domain', 'all', '--no-wait', '--json'], { timeout: 90000 });
  const url = r.json && r.json.verification_url;
  const code = r.json && r.json.device_code;
  if (!url || !code) { log('❌ 发起授权失败：' + (r.err || r.raw).slice(0, 400)); return; }
  log('');
  log('请在浏览器或飞书中打开下面这个链接完成授权（10 分钟内有效）：');
  log(url);
  log('');
  const qrPath = path.join(ROOT, 'out', 'lark-qr.png');
  try {
    fs.mkdirSync(path.dirname(qrPath), { recursive: true });
    const qr = lark(['auth', 'qrcode', url, '--output', 'out/lark-qr.png'], { timeout: 60000 });
    if (qr.ok) { log('二维码已保存并尝试打开：out/lark-qr.png'); openPath(qrPath); }
  } catch {}
  if (noWait) {
    log('授权完成后运行：node cli.mjs lark-setup --finish ' + code);
    return;
  }
  log('等待授权完成…（最多 10 分钟，完成后本命令会自动继续）');
  const done = lark(['auth', 'login', '--device-code', code, '--json'], { timeout: 600000 });
  if (done.ok) { log('✅ 飞书授权完成，可以运行 node cli.mjs lark-init 创建 Base'); saveIdentity(); }
  else log('❌ 授权未完成：' + (done.err || done.raw).slice(0, 300) + '（可重试 node cli.mjs lark-setup）');
}
