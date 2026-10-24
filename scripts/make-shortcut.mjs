// 在桌面创建「一点就开」的看板入口
//   macOS  → Canvas 课程看板.app（自动检查/拉起服务后打开浏览器）
//   Windows→ Canvas 课程看板.url + 同名的 .cmd（服务没在跑就先拉起来）
//   Linux  → Canvas 课程看板.desktop
//
// 用法：node scripts/make-shortcut.mjs   （或 node cli.mjs shortcut）

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, loadConfig, log } from "../src/util.mjs";
import { iconFor } from "../src/icons.mjs";

// 配置缺失时也能用（例如全新解压、还没跑过安装向导）
let cfg = {};
try { cfg = loadConfig(); } catch (e) { cfg = {}; }
const PORT = Number(process.env.CANVAS_HUB_PORT || (cfg.web && cfg.web.port) || 8788);
const URL = "http://127.0.0.1:" + PORT + "/";
const NAME = "Canvas 课程看板";
const DESKTOP = path.join(os.homedir(), "Desktop");

const BS = String.fromCharCode(92);
const Q = String.fromCharCode(34);

function run(cmd, args, opts) {
  return spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...(opts || {}) });
}
function ensureDesktop() {
  fs.mkdirSync(DESKTOP, { recursive: true });
  return DESKTOP;
}
// AppleScript 字符串字面量：转义反斜杠与双引号
function appleLit(s) {
  let out = String(s).split(BS).join(BS + BS);
  out = out.split(Q).join(BS + Q);
  return Q + out + Q;
}

// ---------------- macOS ----------------
function makeMacApp() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chub-shortcut-"));
  const lines = [
    "on run",
    "set thePort to " + Q + String(PORT) + Q,
    "set theURL to " + Q + "http://127.0.0.1:" + Q + " & thePort & " + Q + "/" + Q,
    "set isUp to false",
    "try",
    "do shell script " + Q + "/usr/bin/curl -s -m 2 -o /dev/null http://127.0.0.1:" + Q + " & thePort & " + Q + "/api/health" + Q,
    "set isUp to true",
    "end try",
    "if isUp is false then",
    "try",
    "do shell script " + Q + "/bin/launchctl kickstart -k gui/$(id -u)/com.canvashub.web" + Q,
    "end try",
    "repeat 24 times",
    "delay 0.5",
    "try",
    "do shell script " + Q + "/usr/bin/curl -s -m 1 -o /dev/null http://127.0.0.1:" + Q + " & thePort & " + Q + "/api/health" + Q,
    "set isUp to true",
    "exit repeat",
    "end try",
    "end repeat",
    "end if",
    "if isUp is false then",
    "try",
    "do shell script " + Q + "cd " + Q + " & quoted form of " + Q + ROOT.split(BS).join(BS + BS) + Q + " & " + Q + " && nohup node server.mjs > logs/shortcut.log 2>&1 &" + Q,
    "end try",
    "repeat 24 times",
    "delay 0.5",
    "try",
    "do shell script " + Q + "/usr/bin/curl -s -m 1 -o /dev/null http://127.0.0.1:" + Q + " & thePort & " + Q + "/api/health" + Q,
    "set isUp to true",
    "exit repeat",
    "end try",
    "end repeat",
    "end if",
    "if isUp is false then",
    "display dialog " + Q + "看板服务没能启动。请在终端手动运行：node server.mjs" + Q + " buttons {" + Q + "好" + Q + "} default button 1 with icon caution",
    "return",
    "end if",
    "open location theURL",
    "end run",
    "",
  ];
  const scriptPath = path.join(tmp, "entry.applescript");
  fs.writeFileSync(scriptPath, lines.join(String.fromCharCode(10)));
  const built = path.join(tmp, "built.app");
  const compile = run("/usr/bin/osacompile", ["-o", built, scriptPath]);
  if (compile.error || compile.status !== 0) {
    log("❌ osacompile 失败：" + String((compile.stderr || compile.error || "").toString()).slice(0, 300));
    return null;
  }
  // 图标（可选，失败不影响可用性）
  try {
    const png = path.join(tmp, "icon.png");
    fs.writeFileSync(png, iconPng());
    const iconset = path.join(tmp, "AppIcon.iconset");
    fs.mkdirSync(iconset, { recursive: true });
    const sizes = [16, 32, 128, 256, 512];
    for (const s of sizes) {
      run("/usr/bin/sips", ["-z", String(s), String(s), png, "--out", path.join(iconset, "icon_" + s + "x" + s + ".png")]);
      run("/usr/bin/sips", ["-z", String(s * 2), String(s * 2), png, "--out", path.join(iconset, "icon_" + s + "x" + s + "@2x.png")]);
    }
    const icns = path.join(tmp, "applet.icns");
    const built2 = run("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", icns]);
    if (!built2.error && built2.status === 0) fs.copyFileSync(icns, path.join(built, "Contents", "Resources", "applet.icns"));
    run("/usr/bin/xattr", ["-cr", built]);
    run("/usr/bin/codesign", ["--force", "--deep", "-s", "-", built]);
  } catch (e) { /* 图标不是必需的 */ }
  // 桌面可能被 iCloud 同步（osacompile 直接写会被系统拒绝 -4960），所以先编译再 ditto 过去
  const dest = path.join(ensureDesktop(), NAME + ".app");
  fs.rmSync(dest, { recursive: true, force: true });
  const copy = run("/usr/bin/ditto", [built, dest]);
  if (copy.error || copy.status !== 0) {
    log("❌ 拷贝到桌面失败：" + String((copy.stderr || copy.error || "")).toString().slice(0, 300));
    return null;
  }
  run("/usr/bin/touch", [dest]);
  fs.rmSync(tmp, { recursive: true, force: true });
  return dest;
}

function iconPng() {
  // 复用看板自己的图标（运行时代码生成，无需联网）
  try { return iconFor("512"); } catch (e) { return Buffer.alloc(0); }
}

// ---------------- Windows ----------------
function makeWindows() {
  const dir = ensureDesktop();
  const urlFile = path.join(dir, NAME + ".url");
  fs.writeFileSync(urlFile, "[InternetShortcut]" + String.fromCharCode(13, 10) + "URL=" + URL + String.fromCharCode(13, 10) + "IconIndex=0" + String.fromCharCode(13, 10));
  // 带自检与自动拉起的 .cmd（不依赖 curl：Windows 上常有 schannel 问题，统一用 node）
  const cmdFile = path.join(dir, NAME + ".cmd");
  const probe = "node -e " + Q + "fetch(" + Q + URL + "api/health" + Q + ").then(function(r){process.exit(r.ok?0:1)}).catch(function(){process.exit(1)})" + Q;
  const body = [
    "@echo off",
    "chcp 65001 >nul",
    probe,
    "if errorlevel 1 (",
    "  start " + Q + Q + " /min cmd /c " + Q + "cd /d " + Q + Q + ROOT + Q + Q + " && node server.mjs" + Q,
    "  ping -n 4 127.0.0.1 >nul",
    ")",
    "start " + Q + Q + " " + Q + URL + Q,
    "",
  ].join(String.fromCharCode(13, 10));
  fs.writeFileSync(cmdFile, body);
  return urlFile + "  /  " + cmdFile;
}

// ---------------- Linux ----------------
function makeLinux() {
  const dir = ensureDesktop();
  const file = path.join(dir, "canvas-hub.desktop");
  const exec = "sh -c " + Q + "curl -sf " + URL + "api/health >/dev/null 2>&1 || (cd " + Q + Q + ROOT + Q + Q + " && nohup node server.mjs >/dev/null 2>&1 &); sleep 1; xdg-open " + URL + Q;
  const body = [
    "[Desktop Entry]",
    "Type=Application",
    "Name=" + NAME,
    "Comment=Canvas 课程看板（本地）",
    "Exec=" + exec,
    "Terminal=false",
    "Categories=Education;",
    "",
  ].join(String.fromCharCode(10));
  fs.writeFileSync(file, body);
  fs.chmodSync(file, 0o755);
  return file;
}

export function makeShortcut() {
  log("=== 创建桌面入口 ===");
  log("  看板地址：" + URL);
  let made = null;
  if (process.platform === "darwin") made = makeMacApp();
  else if (process.platform === "win32") made = makeWindows();
  else made = makeLinux();
  if (!made) { log("❌ 创建失败"); return false; }
  log("✅ 已创建：" + made);
  if (process.platform === "win32") log("   双击 .url 直接打开；.cmd 会先检查服务是否在跑。");
  if (process.platform === "darwin") log("   双击后自动检查并拉起服务，然后用默认浏览器打开看板。");
  log("   想换地方或改名：直接把生成的文件拖走 / 改名即可。");
  return true;
}

if (process.argv[1] && process.argv[1].endsWith("make-shortcut.mjs")) {
  makeShortcut();
}
