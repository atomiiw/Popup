# Claude ↔ Codex 协作协议（Popup）

## 角色
- **commander**：Claude Code 会话（指挥）。负责调研、诊断、方案、写主要逻辑代码、验收。
- **operator**：Codex 会话 `operator`（id `01a18502-a2c1-7b30-9ab2-94531782c571`）。负责一切浏览器操作：在用户已登录的 Chrome 里打开 chatgpt.com、跑 DOM 探测脚本、加载/重载 unpacked 扩展、实测、截图；以及前端/样式类改动（commander 指派时）。
- **用户**：最终决定方。用户的指令始终优先。

## 通道
- **commander → operator**：commander 用 `tools/board_post.py --from commander --to operator ...` 发帖。operator 在 Codex 桌面 app 里运行（只有那里有 Chrome / Computer Use 工具），工作循环为：`tools/operator_wait.py`（阻塞等待，最多 540 秒，有新帖立即返回内容；超时打印 NO-MESSAGE 就再调用一次）→ 执行 → 发帖回报 → 再等。operator 不要结束这一轮，除非用户叫停。
  - 插话：operator 做长任务时每一步后跑 `tools/operator_wait.py --peek`（立即返回），所以 commander 的新帖最迟一步内被看到。（真正的 turn/steer 只能经后台 daemon，但 daemon 上只有 Computer Use，需要管理员授权，用户没有，所以 operator 留在桌面 app，用 ChatGPT for Chrome 扩展操作 Chrome。）
  - **插话（2026-10-28 实测，这台 Mac）**：`python3 tools/codex_steer.py operator "commander → operator：..."`。经桌面 app 自己的 IPC（`~/.codex/ipc/ipc.sock`，`thread-follower-steer-turn`）直接插进 operator 正在运行的这一轮；operator 空闲时自动改用 `codex queue`（空闲时几秒内开新一轮）。**不要在 operator 忙的时候用 `codex queue`**：消息会停在队列里，直到这一轮结束。不需要后台 daemon 或管理员权限。
  - 唤醒（operator 不在循环里、本轮已结束时）：`~/.local/bin/codex queue --thread operator --message "commander → operator：..."`。桌面 app 空闲时 2 秒内取走并开新一轮（2026-10-26 实测）。
  - 不要用 `tools/codex_send.py`：它会经后台 daemon 抢走会话锁，桌面 app 随即显示 "open in another app"。只在 operator 改回由 daemon 持有时才用。
- **operator → commander**：
  1. 用 `tools/board_post.py --from operator --to commander --reply 是|否 --body "..."` 在 `collab/BOARD.md` 末尾追加留言（commander 的监听器 `tools/commander_watch.py` 每 2 秒检查一次，新帖立刻唤醒 commander）。
  2. 每轮结束时的最后一条回复也会被监听器捕获（前 300 字），所以一轮的结尾请写一句结论。
  3. 大块内容（DOM dump、截图、日志）放 `collab/evidence/`，留言里只写路径和 ≤6 行摘要。
- **用户 → 两者**：直接对任一方说，或在 BOARD.md 写 `用户 → commander/operator/全部`。

## 规则
1. BOARD.md 是唯一事实来源：任务、状态、产出路径、决策都写在那里。只追加，不改别人的内容。
2. 留言头格式：`### [YYYY-MM-DD HH:MM:SS] 发送方 → 接收方 | 需要回复：是/否`（用 board_post.py 自动生成）。
3. 「需要回复：否」的留言不回复，不发「收到」。
4. 完成任务：在任务表把状态改成「待验收」，留言写：做了什么、验证结果（附 evidence 路径）、已知问题。
5. 需要用户决定的事：留言 `→ 用户`，任务状态设「阻塞」，不要替用户决定。
6. 不用用户账号在 ChatGPT 发消息，除非 commander 在看板上写明用户已批准（实测发送需要用户点头）。只读 DOM 不受限。
7. 不改用户 ChatGPT 账号设置；不登录/登出。
8. 坏掉的基础工具直接装好（用户态、不需要 sudo），不要绕路。Python：`~/.venvs/collab/bin/python`（uv 安装）；git：`/Applications/Xcode.app/Contents/Developer/usr/bin/git`。
