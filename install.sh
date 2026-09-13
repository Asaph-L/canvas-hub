#!/usr/bin/env bash
# Canvas 课程管家 · 一键安装 / 升级（macOS）
#
#  交互式安装：    bash install.sh
#  无人值守安装：  NONINTERACTIVE=1 CANVAS_TOKEN=xxx bash install.sh
#
# 可覆盖的环境变量：
#   CANVAS_URL / CANVAS_TOKEN / FILES_DIR / DEEPSEEK_KEY / TARGET_DIR / PORT
#   ENABLE_MACOS / ENABLE_WEB / ENABLE_SCHEDULE / ENABLE_LARK / MORNING / EVENING / TARGET_PERCENT

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NONINTERACTIVE="${NONINTERACTIVE:-0}"
ANSWER=""

say() { echo "$1"; }
ok() { echo "✅ $1"; }
warn() { echo "⚠️  $1"; }
err() { echo "❌ $1"; }

ask() {
  local prompt="$1" def="${2:-}"
  if [ "$NONINTERACTIVE" = "1" ]; then ANSWER="$def"; return 0; fi
  if [ -n "$def" ]; then printf '%s [%s]: ' "$prompt" "$def"; else printf '%s: ' "$prompt"; fi
  read -r ANSWER || true
  [ -z "$ANSWER" ] && ANSWER="$def"
  return 0
}

askyn() {
  local prompt="$1" def="${2:-Y}" ans=""
  if [ "$NONINTERACTIVE" = "1" ]; then [ "$def" = "Y" ]; return $?; fi
  printf '%s [y/n，默认 %s]: ' "$prompt" "$def"
  read -r ans || true
  [ -z "$ans" ] && ans="$def"
  case "$ans" in y|Y|yes|YES|是) return 0;; *) return 1;; esac
}

asksecret() {
  local prompt="$1" def="${2:-}"
  if [ "$NONINTERACTIVE" = "1" ]; then ANSWER="$def"; return 0; fi
  printf '%s' "$prompt"
  read -rs ANSWER || true
  printf '\n'
  [ -z "$ANSWER" ] && ANSWER="$def"
  return 0
}

echo "==============================================="
echo "   Canvas 课程管家 · 安装向导"
echo "==============================================="
echo "本向导会："
echo "  1. 把程序安装到你指定的目录"
echo "  2. 填入你自己的 Canvas Token（只保存在本机）"
echo "  3. 可选开启：macOS 通知 / Web 看板 / 飞书集成 / 定时任务"
echo "  4. 立即同步一次，验证一切正常"
echo "所有数据都只在你自己的电脑上，不会上传到任何服务器。"
echo ""

OS="$(uname -s)"
if [ "$OS" != "Darwin" ]; then
  warn "当前系统是 ${OS}：定时任务与系统通知仅支持 macOS，其余功能可正常使用。"
  SCHEDULE_DEFAULT="N"
else
  SCHEDULE_DEFAULT="Y"
fi

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ] && [ -x "/opt/homebrew/bin/node" ]; then NODE_BIN="/opt/homebrew/bin/node"; fi
if [ -z "$NODE_BIN" ]; then
  warn "未检测到 Node.js（程序运行需要它）"
  BREW_BIN="$(command -v brew || true)"
  if [ -n "$BREW_BIN" ]; then
    if askyn "是否现在自动安装 Node（brew install node，约 1-2 分钟）" "Y"; then
      "$BREW_BIN" install node || warn "Homebrew 安装失败，可手动执行 brew install node"
      NODE_BIN="$(command -v node || true)"
      if [ -z "$NODE_BIN" ] && [ -x "/opt/homebrew/bin/node" ]; then NODE_BIN="/opt/homebrew/bin/node"; fi
    fi
  else
    echo "    没有检测到 Homebrew，二选一："
    echo "    1) 先装 Homebrew（brew.sh），再执行 brew install node"
    echo "    2) 到 nodejs.org 下载 LTS 安装包（更简单，双击安装即可）"
  fi
  if [ -z "$NODE_BIN" ]; then err "仍未检测到 Node.js，安装中止"; exit 1; fi
fi
NODE_MAJOR="$("$NODE_BIN" -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  err "Node 版本过低（$("$NODE_BIN" -v)），需要 18 或更高版本。"
  exit 1
fi
ok "Node $("$NODE_BIN" -v)（${NODE_BIN}）"
echo ""

TARGET_DIR="${TARGET_DIR:-}"
if [ -z "$TARGET_DIR" ]; then
  ask "程序安装到哪个目录" "$HOME/Desktop/canvas-hub"
  TARGET_DIR="$ANSWER"
fi
mkdir -p "$TARGET_DIR"
if [ "$(cd "$TARGET_DIR" && pwd)" != "$SCRIPT_DIR" ]; then
  ok "正在复制程序文件到 $TARGET_DIR …"
  rsync -a --exclude 'data' --exclude 'logs' --exclude 'dist' --exclude 'secrets.json' --exclude 'config.json' --exclude '.git' --exclude 'LaunchAgents' --exclude '.DS_Store' "$SCRIPT_DIR"/ "$TARGET_DIR"/
else
  ok "就地安装（程序目录即安装目录）"
fi
cd "$TARGET_DIR" || exit 1

FILES_DIR="${FILES_DIR:-}"
if [ -z "$FILES_DIR" ]; then
  ask "课程文件保存到哪个目录（不存在会自动创建）" "$HOME/Desktop/CityU-Courses"
  FILES_DIR="$ANSWER"
fi
mkdir -p "$FILES_DIR"
ok "课程资料目录：$FILES_DIR"
echo ""

CANVAS_URL="${CANVAS_URL:-}"
if [ -z "$CANVAS_URL" ]; then
  ask "Canvas 地址" "https://canvas.cityu.edu.hk"
  CANVAS_URL="$ANSWER"
fi
CANVAS_URL="$(printf '%s' "$CANVAS_URL" | sed 's:/*$::')"

CANVAS_TOKEN="${CANVAS_TOKEN:-}"
attempt=0
while [ -z "$CANVAS_TOKEN" ] && [ "$attempt" -lt 3 ]; do
  if [ "$NONINTERACTIVE" != "1" ]; then
    echo ""
    echo "获取 Canvas Token（约 30 秒）："
    echo "   Canvas 右上角头像 → 账户/Account → 设置/Settings"
    echo "   → 已批准集成/Approved Integrations → + New Access Token → 复制生成的字符串"
  fi
  asksecret "粘贴 Canvas Token（输入时不显示）: " ""
  CANVAS_TOKEN="$ANSWER"
  attempt=$((attempt + 1))
done

if [ -n "$CANVAS_TOKEN" ]; then
  # 用 Node 的 fetch 校验，不依赖 curl（部分系统 TLS 栈异常时 curl 会误报）
  who="$(CANVAS_URL="$CANVAS_URL" CANVAS_TOKEN="$CANVAS_TOKEN" "$NODE_BIN" -e 'fetch(process.env.CANVAS_URL + "/api/v1/users/self", { headers: { Authorization: "Bearer " + process.env.CANVAS_TOKEN } }).then(async function (r) { if (!r.ok) { process.exit(1); } var j = await r.json(); process.stdout.write(j.name || ""); }).catch(function () { process.exit(1); })' 2>/dev/null || true)"
  if [ -n "$who" ]; then
    ok "Canvas 连接成功，账号：$who"
  else
    warn "Canvas 校验没通过（Token/地址可能有误，或网络受限）；稍后可用 node cli.mjs doctor 复查"
  fi
else
  warn "未填写 Canvas Token，同步功能不可用（可在 config.json / secrets.json 里补）"
fi
echo ""

DEEPSEEK_KEY="${DEEPSEEK_KEY:-}"
if [ "$NONINTERACTIVE" != "1" ]; then
  echo "DeepSeek API Key（可选）：用于对话助手、大纲权重解析、智能分类。"
  echo "   获取：https://platform.deepseek.com → API Keys → 创建"
  echo "   费用提示：按用量计费，日常使用大约每月几毛到几块钱；首次解析大纲时会一次性消耗稍多。"
  asksecret "粘贴 DeepSeek API Key（没有就直接回车跳过）: " ""
  DEEPSEEK_KEY="$ANSWER"
fi
if [ -n "$DEEPSEEK_KEY" ]; then ok "DeepSeek Key 已记录"; else warn "未填 DeepSeek Key：对话与智能解析不可用，其余功能正常"; fi
echo ""

ENABLE_MACOS="${ENABLE_MACOS:-}"
if [ -z "$ENABLE_MACOS" ]; then
  if askyn "启用 macOS 系统通知（零配置，推荐）" "Y"; then ENABLE_MACOS=1; else ENABLE_MACOS=0; fi
fi
ENABLE_WEB="${ENABLE_WEB:-}"
if [ -z "$ENABLE_WEB" ]; then
  if askyn "启用 Web 看板（含日历、对话、设置，默认 8788 端口）" "Y"; then ENABLE_WEB=1; else ENABLE_WEB=0; fi
fi
ENABLE_SCHEDULE="${ENABLE_SCHEDULE:-}"
if [ -z "$ENABLE_SCHEDULE" ]; then
  if askyn "启用定时任务（每天自动同步 + 截止提醒）" "$SCHEDULE_DEFAULT"; then ENABLE_SCHEDULE=1; else ENABLE_SCHEDULE=0; fi
fi
MORNING="${MORNING:-}"
EVENING="${EVENING:-}"
if [ "$ENABLE_SCHEDULE" = "1" ]; then
  if [ -z "$MORNING" ]; then ask "每天几点同步" "08:00"; MORNING="$ANSWER"; fi
  if [ -z "$EVENING" ]; then ask "每天几点检查次日截止" "20:00"; EVENING="$ANSWER"; fi
fi

ENABLE_LARK="${ENABLE_LARK:-}"
if [ -z "$ENABLE_LARK" ]; then
  echo ""
  echo "飞书集成（可选）：截止日期进飞书日历、数据存飞书多维表格、摘要发到飞书。"
  echo "   需要先安装 lark-cli 并用自己的飞书账号授权一次；不启用完全不影响其它功能。"
  if askyn "启用飞书集成" "N"; then ENABLE_LARK=1; else ENABLE_LARK=0; fi
fi
LARK_CLI=""
if [ "$ENABLE_LARK" = "1" ]; then
  LARK_CLI="$(command -v lark-cli || true)"
  if [ -z "$LARK_CLI" ] && [ -x "/opt/homebrew/bin/lark-cli" ]; then LARK_CLI="/opt/homebrew/bin/lark-cli"; fi
  if [ -z "$LARK_CLI" ]; then
    warn "未找到 lark-cli。请先运行：npx @larksuite/cli@latest install"
    warn "安装完成后重新运行 bash install.sh，或手动执行 node cli.mjs lark-setup"
    ENABLE_LARK=0
  fi
fi

WEB_LANG="${WEB_LANG:-}"
if [ -z "$WEB_LANG" ]; then
  echo ""
  echo "网页看板界面语言：1) 中文（默认）  2) English"
  ask "请选择" "1"
  case "$ANSWER" in 2|en|EN|English|english) WEB_LANG="en";; *) WEB_LANG="zh";; esac
fi
export WEB_LANG

ENABLE_DEMO="${ENABLE_DEMO:-}"
if [ -z "$ENABLE_DEMO" ]; then
  if [ -n "$CANVAS_TOKEN" ]; then
    ENABLE_DEMO=0
  else
    echo ""
    echo "还没有 Canvas Token？可以先看演示数据（3 门假课程 + 成绩与安全线示例）体验界面。"
    if askyn "生成演示数据" "Y"; then ENABLE_DEMO=1; else ENABLE_DEMO=0; fi
  fi
fi

MACOS_FLAG=0
[ "$ENABLE_MACOS" = "1" ] && MACOS_FLAG=1
LARK_FLAG=0
[ "$ENABLE_LARK" = "1" ] && LARK_FLAG=1
PORT_NUM="${PORT:-8788}"
CANVAS_EXCLUDE=""
case "$CANVAS_URL" in *cityu*) CANVAS_EXCLUDE="SD_ANTI_DECEPTION,SD_CASH";; esac

echo ""
ok "正在写入配置 …"
CANVAS_URL="$CANVAS_URL" CANVAS_TOKEN="$CANVAS_TOKEN" DEEPSEEK_KEY="$DEEPSEEK_KEY" FILES_DIR="$FILES_DIR" \
  PORT="$PORT_NUM" MACOS="$MACOS_FLAG" ENABLE_DESKTOP="$MACOS_FLAG" LARK="$LARK_FLAG" LARK_CLI="$LARK_CLI" \
  MORNING="${MORNING:-08:00}" EVENING="${EVENING:-20:00}" CANVAS_EXCLUDE="$CANVAS_EXCLUDE" \
  TARGET_PERCENT="${TARGET_PERCENT:-60}" \
  "$NODE_BIN" scripts/gen-config.mjs

if [ -n "$CANVAS_TOKEN" ]; then
  echo ""
  ok "执行首次同步（可能需要 1-2 分钟）…"
  "$NODE_BIN" cli.mjs sync || warn "首次同步未完成，稍后可运行 node cli.mjs sync 重试"
fi

if [ "$ENABLE_DEMO" = "1" ]; then
  echo ""
  "$NODE_BIN" cli.mjs demo || true
fi

if [ "$OS" = "Darwin" ] && { [ "$ENABLE_SCHEDULE" = "1" ] || [ "$ENABLE_WEB" = "1" ]; }; then
  MORNING_FLAG=0; EVENING_FLAG=0; WEB_FLAG=0
  [ "$ENABLE_SCHEDULE" = "1" ] && MORNING_FLAG=1
  [ "$ENABLE_SCHEDULE" = "1" ] && EVENING_FLAG=1
  [ "$ENABLE_WEB" = "1" ] && WEB_FLAG=1
  echo ""
  ok "正在安装后台任务 …"
  NODE_BIN="$NODE_BIN" PORT="$PORT_NUM" ENABLE_MORNING="$MORNING_FLAG" ENABLE_EVENING="$EVENING_FLAG" ENABLE_WEB="$WEB_FLAG" \
    MORNING="${MORNING:-08:00}" EVENING="${EVENING:-20:00}" "$NODE_BIN" scripts/schedule.mjs install
fi

if [ "$ENABLE_WEB" = "1" ]; then
  sleep 2
  open "http://127.0.0.1:$PORT_NUM" >/dev/null 2>&1 || true
fi

if [ "$ENABLE_LARK" = "1" ]; then
  echo ""
  echo "飞书还差两步（现在或以后都行）："
  echo "   1) node cli.mjs lark-setup     # 按提示在浏览器/飞书里完成授权"
  echo "   2) node cli.mjs lark-init      # 创建飞书多维表格并绑定"
fi

echo ""
echo "==============================================="
ok "安装完成！"
echo "  程序目录：$TARGET_DIR"
echo "  资料目录：$FILES_DIR"
echo "  Web 看板：http://127.0.0.1:$PORT_NUM"
echo "  手机看板：在网页「设置 → 手机配对」里扫码（手机与电脑同一 WiFi，首次按提示装一次证书）"
echo ""
echo "常用命令（在程序目录执行）："
echo "  node cli.mjs doctor     # 体检，出问题先跑这个"
echo "  node cli.mjs sync       # 手动同步一次"
echo "  node cli.mjs daily      # 完整流程（同步+摘要+日历+Base+推送）"
echo "  node cli.mjs demo       # 生成演示数据（体验界面）；demo --off 退出"
echo ""
echo "  定时时间、界面语言、课程过滤等都可在 config.json 里随时修改。"
echo ""
echo "卸载：bash uninstall.sh"
echo "==============================================="
echo ""
"$NODE_BIN" cli.mjs doctor || true
