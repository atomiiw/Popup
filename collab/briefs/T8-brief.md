# T8 — commander → operator：附件最后验证（1.2.11-dev.8，这一轮最多 3 条消息）

先刷新并确认 `#jr-diagnostics` 的 version 是 `1.2.11-dev.8`。存 `collab/evidence/s2/t8/`。不改账号设置。截图标准同 T2（只截 popup 和相关区域，popup 完全不透明，PNG）。只在「Popup 格式测试」对话里发。用你 T6 的办法贴文件。

## 1. 两张同名图 + PDF（第 1 条）
新 popup 里依次贴入蓝图、橙图（两张都会叫 clipboard.png）和 PDF，问 `这三个附件分别是什么？各用一句话。` 并发送。
- **回答出来以后**：问题上方是 2 个缩略图 + 1 个 PDF 方块，**只有一排**；**没有**「not sent」提示。截图 `1-after-answer.png`。

## 2. 空文件（第 2 条）
新 popup 里贴入一个 0 字节的 text/plain 文件，问 `你收到附件了吗？` 并发送。
- **回答出来以后**：问题下方有灰色小字「1 attachment was not sent: …」。截图 `2-note.png`。

## 3. 编辑换图（第 3 条）
打开第 1 步的 popup，点问题进入编辑：上方那排附件**暂时不见**（编辑从空白开始）。贴入橙色图，改问题为 `那这张呢？只回答颜色。`，发送。
- 回答出来以后：第 2 版上方只有 1 个橙色缩略图；切回第 1 版，上方又是 2 图 + PDF；再切回第 2 版。截图 `3-v2.png`、`3-v1.png`。

## 4. 刷新（不发消息）
刷新（遇到 couldn't load 就从侧栏重新进入），等 5 秒，打开第 1 步的 popup：
- 问题上方应该又出现 2 个缩略图 + 1 个 PDF 方块。图片如果显示成「PNG」方块而不是缩略图，记下 `#jr-diagnostics` 的 data-json 里 `fileUrlStatus` 的值。截图 `4-after-reload.png`。
- 打开第 2 步的 popup：刷新后**不再**显示「not sent」提示（预期如此：只在当次会话显示）。
- 打开第 3 步的 popup，切换两个版本，各自的附件对不对。

## 5. 你自己的附件在 ChatGPT 输入框里时，Popup 不发送（不发消息）
在 **ChatGPT 自己的输入框**里贴一个 PDF（不发送）。然后开一个新 popup，写个问题 `测试`，贴入蓝图，点 popup 的发送：
- 预期：**没有发出去**；popup 里问题下方出现「ChatGPT’s input box still has your own attachments…」；popup 里的问题文字和蓝图都还在；ChatGPT 输入框里你的 PDF 卡片还在，旁边没有多出蓝图卡片。截图 `5-blocked.png`。
然后按 Esc 关掉 popup（不要发送），点 × 删掉 ChatGPT 输入框里的 PDF，确认输入框清空。

回报：`python3 tools/board_post.py --from operator --to commander --reply 是 --body "T8 完成：…"`，逐项写通过 / 不通过，用了几条消息。
