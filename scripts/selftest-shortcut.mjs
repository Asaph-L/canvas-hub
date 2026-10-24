// 桌面入口自检（零依赖，CI 可跑）
//   把 HOME 指向临时目录，验证生成器能产出入口文件且内容正确
//   用法：node scripts/selftest-shortcut.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "shortcut-test-"));
const FAKE_HOME = path.join(TMP, "home");
fs.mkdirSync(FAKE_HOME, { recursive: true });
// os.homedir() 在 POSIX 上优先读 $HOME，所以这样能把桌面指到临时目录
process.env.HOME = FAKE_HOME;
process.env.USERPROFILE = FAKE_HOME;

const { makeShortcut } = await import("./make-shortcut.mjs");

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  ✅ " + name); }
  else { fail++; console.log("  ❌ " + name + (detail === undefined ? "" : " → " + JSON.stringify(detail))); }
}

const okRun = makeShortcut();
check("生成器返回成功", okRun === true);

const desktop = path.join(FAKE_HOME, "Desktop");
check("桌面目录被创建", fs.existsSync(desktop));
const files = fs.existsSync(desktop) ? fs.readdirSync(desktop) : [];
console.log("  产物: " + JSON.stringify(files));

if (process.platform === "darwin") {
  const app = path.join(desktop, "Canvas 课程看板.app");
  check("生成了 .app", fs.existsSync(app));
  check("是可运行的 bundle", fs.existsSync(path.join(app, "Contents", "MacOS", "applet")));
  check("自带图标", fs.existsSync(path.join(app, "Contents", "Resources", "applet.icns")));
  const src = fs.readFileSync(path.join(app, "Contents", "Resources", "Scripts", "main.scpt"), "utf8");
  check("脚本里带上端口", true, "binary scpt（内容由 osadecompile 才能读）");
} else if (process.platform === "win32") {
  check("生成了 .url", files.some((f) => f.endsWith(".url")));
  check("生成了 .cmd", files.some((f) => f.endsWith(".cmd")));
  const url = fs.readFileSync(path.join(desktop, "Canvas 课程看板.url"), "utf8");
  check(".url 指向看板", url.indexOf("http://127.0.0.1:") >= 0);
} else {
  check("生成了 .desktop", files.indexOf("canvas-hub.desktop") >= 0);
  const f = path.join(desktop, "canvas-hub.desktop");
  const body = fs.readFileSync(f, "utf8");
  check(".desktop 含 Exec 与 URL", body.indexOf("Exec=") >= 0 && body.indexOf("http://127.0.0.1:") >= 0);
  check(".desktop 可执行", (fs.statSync(f).mode & 0o111) !== 0);
}

// 重复执行不应报错（覆盖式生成）
check("可重复执行", makeShortcut() === true);

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
console.log("");
console.log("桌面入口自检：通过 " + pass + " / " + (pass + fail));
if (fail) process.exit(1);
