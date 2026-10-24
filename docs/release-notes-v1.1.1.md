# v1.1.1 · 桌面快捷入口

看板是个本地网址（`http://127.0.0.1:8788`），时间一长很容易忘。这一版加一条命令，把它变成桌面上**点一下就开**的图标。

## 用法

    node cli.mjs shortcut

桌面上就会出现 **Canvas 课程看板**：

| 系统 | 生成什么 | 双击后发生什么 |
| --- | --- | --- |
| **macOS** | `Canvas 课程看板.app` | 先检查本机服务，没在跑就自动拉起（最多等十几秒），然后用默认浏览器打开看板 |
| **Windows** | `Canvas 课程看板.url` + `.cmd` | .url 直接打开；.cmd 会先用 Node 探活并拉起服务再打开 |
| **Linux** | `canvas-hub.desktop` | 自动拉起服务 + `xdg-open` 打开 |

图标用的是看板自己那个「C」标志，所以一眼能认出来。

## 为什么不用普通书签

服务没在跑时，普通书签只会给你一个"无法连接"。这个入口会先确认服务状态：macOS 走 launchd 拉起（该任务本来就是 `KeepAlive`），失败再兜底直接 `node server.mjs`；Windows 用 Node 探活（你机器上 curl/schannel 不可靠，所以没用 curl）。

## 小细节

- macOS 桌面如果开了 iCloud「桌面与文稿」同步，编译 app 直接写桌面会被系统拒绝（`-4960`）；实现上先在临时目录编译再 `ditto` 过去，所以 iCloud 桌面也能用
- 路径含空格（例如 `cityU semA`）也安全：AppleScript 用 `quoted form of`，Windows 用引号包裹
- 想改名或挪位置，直接把生成的文件拖走即可；重复执行会覆盖同名入口

## 下载哪个？

| 你的系统 | 下载 | 安装 |
| --- | --- | --- |
| **Windows** | `canvas-hub-1.1.1-windows.zip` | 解压后：`powershell -ExecutionPolicy Bypass -File install.ps1` |
| **macOS / Linux** | `canvas-hub-1.1.1-macos-linux.tar.gz` | `tar -xzf ... && cd canvas-hub-1.1.1 && bash install.sh` |

## 升级

    cd canvas-hub && git pull

然后运行一次 `node cli.mjs shortcut` 即可。已有配置与数据不受影响。

完整改动见 [CHANGELOG.md](../CHANGELOG.md)。