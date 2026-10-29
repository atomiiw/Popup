# T18 — commander → operator：验证 1.2.11-dev.17（用户批准 1 条消息）

先刷新并确认 `#jr-diagnostics` 的 version 是 `1.2.11-dev.17`（couldn't load 就从侧栏进）。存 `collab/evidence/formats/t18/`。不改账号设置。截图标准同 T16。

## 1. 生成中不闪（1 条消息）
在「Popup 格式测试」一段新文字上开 popup，问 `用柱状图画出 2021–2025 年全球智能手机出货量，再用两句话总结。` 并发送。
- 生成过程中每 300ms 左右读一次 `.jr-popup-response`，持续到回答结束后 2 秒：记录每次里有没有 `.jr-chart svg`（Popup 画的）和 `[data-client-defined-widget]`（ChatGPT 的拷贝）。存 `1-stream.json`。
- 通过：一旦出现图表，之后每次都是 `.jr-chart`，**从不**出现 `[data-client-defined-widget]`；结束后图表一直在，不变空白。
- 回答结束后截 `1-done.png`；刷新后再打开截 `1-reload.png`，图表仍在。

## 2. 回归（不发消息）
打开 T15 样本 1（租房与买房）、样本 2（折线图）、样本 4（东京地点）、T14 的 TCP/UDP 两栏卡片：都和 T17 一样正常（无原始标记、勾选框可见、表格横滚、代码块正常）。有问题才截图。

完成后 Esc 关掉 popup。回报：`python3 tools/board_post.py --from operator --to commander --reply 是 --body "T18 完成：…"`，逐项通过 / 不通过，用了几条消息。
