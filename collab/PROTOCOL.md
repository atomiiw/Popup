# Claude ↔ Codex 协作协议（Popup）

最后更新 2026-10-29。这是 T1–T18（Step 1、Step 2）实际跑通的做法。换电脑后照这个重建，见 `collab/HANDOFF.md` 的「Moving to a new computer」。

## 用户的工作方式（以前只在 Claude 的本地记忆里，换电脑会丢，所以写在这里）
- **用中文回复。** 短句、说清楚改了什么、为什么。
- **先 grilling 再写代码**：任何设计决定先用 grilling skill（mattpocock-skills 插件）跟用户逐轮确认，每个问题给推荐答案，用户确认前不动手。用户常回「都按推荐来」。
- **写完用 ponytail 审查**：`/ponytail-review` 看改动，`/ponytail-audit` 看整个仓库。最好交给一个独立的审查 agent（不带我的结论），发现的问题全部修完、补测试。
- **每个修复的完整流程**：取证 → 离线测试先红 → 修 → 测试变绿 → ponytail 审查 → 版本号 +1 → **请用户重载**（human in the loop：每次新版本都告诉用户「devN 已打包，请重载」，并列出这一版改了什么）→ operator 在真实页面验证 → 证据图进 TODO → 用户同意后推送。**先审查再推**。
- **只做 `docs/TODO-2026H2.md` 当前这一步**，不跳步、不加功能。
- **发消息要批准**：用用户的 ChatGPT 账号发任何消息，都要用户先批一个条数（「批 4 条」），只在用户指定的测试对话里发；用完就停，再要就再问。只读 DOM、刷新、打开已有 popup 不算消息。
- **不改用户的 ChatGPT 账号设置**（例如不切深色模式），不登录登出。
- **证据图**（仓库是公开的 `atomiiw/Popup`）：
  - 只要「修好以后」的图，不要修复前的图。
  - 用户报告的每个 bug、以及盘点时发现并修好的问题（标「盘点时发现」/「测试时发现」），各一张；用户要求过「每种情况都要一张证据」。
  - 放在 `docs/TODO-2026H2.md` 的紧凑表格里：`| 情况 | 现在 | <a href="evidence/x.png"><img src="evidence/x.png" width="200~260"></a> |`，图片文件放 `docs/evidence/`。
  - **只截 popup（和相关的回答区域），绝不截 ChatGPT 侧栏和对话标题。** popup 必须完全不透明（打开后至少等 1.5 秒），PNG；operator 的工具只有 1x 分辨率，用户接受。
  - 提交前我自己逐张看过。
- **高亮颜色规则**：高亮里的文字永远是 `--jr-mark-text`（浅色模式白色、深色模式深色），不管原来什么颜色（灰色坐标轴、彩色代码、链接）。SVG 文字用 `.jr-hl-paint` 代理来画（`src/highlight.js`）。
- **popup 里的回答由 Popup 自己画**（2026-10-29 用户决定，「算了吧别麻烦了」）：刷新后不存、不复用 ChatGPT 画好的 HTML，不调用 ChatGPT 内部渲染，不开隐藏页面。格式问题都在 `JR.renderMarkdown` 和 `styles.css` 里修。
- 用户偏好的 UI：附件是引用框和问题之间单独一层的 45px 小方块，文件名中间省略、保留扩展名；提示只有一行，放在附件那一层。
- 用户不是这台 Mac 的管理员：不要求 sudo，Codex 没有 Computer Use 权限；全部通过浏览器扩展完成。

## 角色
- **commander**：Claude Code 会话。调研、设计、写代码和测试、写任务说明、验收 operator 的证据、改文档、推送。
- **operator**：Codex 桌面 app 里名为 `operator` 的会话（旧 Mac 上 id `01a18502-a2c1-7b30-9ab2-94531782c571`；新电脑新建一个同名会话即可）。负责一切真实浏览器操作：在用户已登录的 Chrome 里用 ChatGPT-for-Chrome 扩展读 DOM、点击、键盘、写剪贴板、拖拽、截图。**不能**在页面里执行 JS、不能 fetch、不能打开 chrome:// 页面（重载扩展由用户做）。
- **用户**：最终决定方。重载扩展、批消息、批推送、上传商店。

## 通道
- **commander → operator（插话，首选）**：`python3 tools/codex_steer.py operator "新任务 Tn：读 collab/evidence/formats/Tn-brief.md 并照做，完成后用 board_post 回报。"`
  - 经桌面 app 自己的 IPC（`~/.codex/ipc/ipc.sock`，`thread-follower-steer-turn`）直接插进 operator 正在跑的这一轮；输出 `STEERED into the running turn …`。
  - operator 空闲时自动改用 `codex queue`（输出 `Queued message …`），空闲会话几秒内开新一轮。
  - **不要在 operator 忙时用 `codex queue`**：消息会排队到这一轮结束（用户原话：「queue == 排队 == 两个小时后你才会收到回信」）。
  - 不要用 `tools/codex_send.py`（会经后台 daemon 抢走会话锁，桌面 app 显示 "open in another app"）。
- **任务说明（brief）**：长任务写成文件 `collab/evidence/formats/Tn-brief.md`（本地），插话里只给路径。格式见下面模板。
- **operator → commander**：`python3 tools/board_post.py --from operator --to commander --reply 是 --body "Tn 完成：…"`，追加到 `collab/BOARD.md`（本地）。正文 ≤ 6 行：逐项通过 / 不通过、用了几条消息、证据路径；完整矩阵写在 `collab/evidence/.../Tn-report.md`。
- **commander 怎么等**：发完任务后开一个 Monitor（后台监听），数 BOARD.md 里 `operator → commander` 的条数，变多就通知：
  ```
  n=$(grep -c "operator → commander" collab/BOARD.md); while true; do m=$(grep -c "operator → commander" collab/BOARD.md); [ "$m" -gt "$n" ] && echo "operator posted ($m)" && n=$m; sleep 5; done
  ```
  每次最多 30 分钟，过期了需要就重开。读最新一条：`awk '/^### /{b=""} {b=b $0 "\n"} END{printf "%s", b}' collab/BOARD.md`。（旧工具 `tools/commander_watch.py` 也能用。）
- **用户 → 两者**：直接对任一方说。

## 任务说明模板（Tn-brief.md）
```
# Tn — commander → operator：<要验证什么>（1.2.x-dev.N，用户批准 K 条消息 / 不发消息）

先刷新并确认 `#jr-diagnostics` 的 version 是 `1.2.x-dev.N`（couldn't load 就从侧栏重新进入）。存 `collab/evidence/<dir>/tn/`。不改账号设置。只在「Popup 格式测试」对话里发。截图标准：只截 popup，完全不透明，PNG，打开后至少等 1.5 秒；长内容在 popup 内滚动分段截（-a、-b…）并拼一张 contact sheet。

## 1. <检查项>（不发消息 / 第 1 条消息：`<逐字的问题>`）
- 操作：…
- 通过标准：…（写清楚能量化的：宽高、scrollWidth/clientWidth、有没有某个元素）
- 截图 `1-xxx.png`，存 innerText `1-xxx.txt` 和 outerHTML `1-xxx.html`。

完成后 Esc 关掉 popup，原生输入框空。
回报：`python3 tools/board_post.py --from operator --to commander --reply 是 --body "Tn 完成：…"`，逐项写通过 / 不通过，用了几条消息。
```
写 brief 的经验：
- 每条要发的消息逐字写出来，写明「等回答完全结束再发下一条」「没出现就记下，不要重发」。
- 让 operator 存原始数据（txt/html/json），我自己核对；它的「通过」要我看图确认。
- 同一个检查分「刚生成」「拉宽到 720px」「刷新后」三种状态（popup 回答有两条渲染路径：刚生成时拷贝 ChatGPT 的 DOM，刷新后由 Popup 自己画）。
- 需要测量的写成数字标准（例如勾选框 ≥ 12×12、表格 wrap 的 scrollWidth > clientWidth、横滚后 scrollLeft > 0）。

## operator 能做 / 已知的办法
- 读 DOM（`#jr-diagnostics[data-json]` 看版本和自检，`#jr-netlog`、`#jr-filterlog`、`#jr-attachlog` 看日志）、点击、键盘、拖拽（拖 popup 左右边缘拉宽，T15 验证过）、1x 截图、在 popup 内滚动分段截图。
- 往 popup 或 ChatGPT 输入框贴文件：`tab.clipboard.write` 写入文件原始字节，再按 ⌘V。测试文件在 `tools/fixtures/`。
- 刷新后 ChatGPT 偶尔显示 "This response couldn't load"（ChatGPT 自己的 bug）：从侧栏重新进入对话即可。
- 验证结束要收尾：Esc 关 popup、ChatGPT 输入框清空、没有残留附件、临时标签页关掉。

## 规则
1. BOARD.md 只追加，不改别人的内容。留言头 `### [YYYY-MM-DD HH:MM:SS] 发送方 → 接收方 | 需要回复：是/否`（board_post.py 自动生成）。「需要回复：否」的不回。
2. 需要用户决定的事，operator 写 `→ 用户` 并停下，不替用户决定。
3. 未经 commander 写明「用户已批准 K 条」，operator 不发消息。
4. `collab/BOARD.md`、`collab/evidence/` 不进 git（会有用户的对话内容）；要公开的证据图由 commander 挑选、确认没有侧栏后复制到 `docs/evidence/`。
