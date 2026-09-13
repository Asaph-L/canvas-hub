# 安全说明（Security）

canvas-hub 是**完全本地运行**的工具：课程数据、Canvas Token、DeepSeek Key 都只存在你自己的电脑上，没有任何服务器中转。这份文档说明它的信任边界、防护措施，以及已知的残余风险。

> English TL;DR: canvas-hub runs entirely on your machine. The desktop dashboard is localhost-only and unauthenticated; phone access goes over a local self-signed HTTPS certificate with a 128-bit token, restricted to private networks. See the tables below for the exact guarantees and residual risks. Report issues via GitHub Issues.

## 信任边界

| 入口 | 地址 | 鉴权 | 谁能访问 |
| --- | --- | --- | --- |
| 桌面看板 | `http://127.0.0.1:8788` | 无（本机即可信边界） | 只有本机进程与浏览器 |
| 手机看板 | `https://<内网IP>:8789` | 128 位访问令牌 | 同一局域网、持有令牌的设备 |
| 证书助手 | `http://<内网IP>:8790` | 无 | 同一局域网（只提供 CA 证书与安装说明，**不含令牌**） |

## 防护措施

| 风险 | 措施 |
| --- | --- |
| 局域网窃听 | 手机端全程 HTTPS（本地自签证书，ECDSA P-256 + SHA-256） |
| 未授权访问 | 局域网必须带 32 位随机令牌（128 位熵），支持 Cookie / 请求头 / Bearer 三种方式；令牌以 SHA-256 摘要做常数时间比较 |
| 令牌泄露到地址栏 | 扫码后立即写入 `HttpOnly; SameSite=Lax; Secure` Cookie，并 302 到不带令牌的地址；响应头 `Referrer-Policy: no-referrer` |
| 令牌被旁观者读取 | 配对接口只允许回环地址访问，令牌只显示在电脑屏幕上；证书安装页与二维码都不含令牌 |
| DNS 重绑定（恶意网页借浏览器读本机接口） | 校验 `Host` 头：只接受 `localhost` / `127.0.0.1` / 私有网段 IP / `.local` 名称，其余一律 403 |
| 路径穿越读取密钥 | 静态文件只按 `basename` 解析并做目录包含校验（`/..%2f..%2fsecrets.json` 这类编码穿越返回 404） |
| 课程文件越权读取 | `/files` 接口做目录包含校验，且局域网访问需要令牌 |
| 点击劫持 | X-Frame-Options: DENY + CSP frame-ancestors 'none' |
| 注入脚本外传数据 | CSP default-src 'self'、connect-src 'self'；看板所有课程数据都走 textContent 渲染，聊天内容先 HTML 转义再套 Markdown |
| 非内网来源扫描 | 来源 IP 不属于私有网段（192.168.x / 10.x / 172.16-31.x）直接拒绝 |
| 配对码被暴力枚举 | 6 位码 10 分钟过期、用一次即废、单个码最多试 5 次、每 IP 每 10 分钟最多 10 次 |
| 密钥落盘被其他用户读取 | `secrets.json` / `data/settings.json` / TLS 私钥 / 令牌文件权限均为 `600`；`data/` 整个目录不进版本库与发布包 |
| 命令注入 | 手动操作只接受白名单命令，通过 `spawn` 传数组参数，不经过 shell |
| 证书被替换（伪 CA） | 电脑配对卡与安装页都显示 CA 的 SHA-256 指纹，可对照手机系统设置里的证书指纹核对 |

## 已知的残余风险

1. **首次安装证书走 HTTP**（`8790` 端口）。这是自签证书的固有限制：手机在信任 CA 之前无法验证 HTTPS。同一局域网内的攻击者若在你安装证书的**那一刻**做中间人，理论上可以塞入自己的 CA；核对上文提到的 SHA-256 指纹即可发现。装好后建议在看板里关掉「局域网访问」，助手端口会同时关闭。
2. **桌面看板对本机不做鉴权**。任何能在这台电脑上运行的程序都能读取你的课程数据 —— 这与其他本地工具一致；真正要防的「别的设备」和「恶意网页」两条已由令牌与 Host 校验覆盖。
3. **Service Worker 会在手机上缓存最近一次状态数据**以便离线查看。手机被他人解锁时能看到这份缓存；在电脑上「重新生成令牌」可阻止对方同步新数据，但已缓存的旧数据仍留在那台手机上。
4. **访问令牌默认长期有效**（Cookie 一年）。手机丢失或转手时，请在电脑看板点「重新生成」让旧令牌立即失效。
5. **局域网访问默认开启**。在公共或不可信网络（咖啡厅、酒店）使用时，建议关掉「局域网访问」，只保留本机使用。

## 已修复的历史问题

### v1.0.2

- **路径穿越（严重）**：静态文件处理未做目录包含校验，`GET /..%2f..%2fsecrets.json` 可直接读出 Canvas Token 与 DeepSeek Key（HTTP 200）。现改为只按 basename 解析并做目录包含校验，并加入回归测试。
- **DNS 重绑定（严重）**：未校验 `Host` 头。恶意网页可让自己的域名解析到 `127.0.0.1`，借浏览器同源策略读取 `/api/pair`（内含局域网访问令牌），从而获得局域网看板权限。现已加 Host 白名单。
- **缺少点击劫持与注入防护**：补充 `X-Frame-Options`、CSP、`Permissions-Policy`。
- **无法核对证书指纹**：配对卡与安装页现显示 CA 的 SHA-256 指纹。

以上四项均已通过 `scripts/selftest-pwa.mjs` 固化为回归断言（CI 在 5 个平台上执行）。

## 报告问题

发现安全问题请开 [GitHub Issue](https://github.com/Asaph-L/canvas-hub/issues)。请在报告里说明影响版本、复现步骤与影响范围。

自检命令：

    node cli.mjs doctor            # 环境与端口体检
    node scripts/selftest-pwa.mjs  # PWA / 局域网 / 鉴权 / 安全回归（46 项断言）
