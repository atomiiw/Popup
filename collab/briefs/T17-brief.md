# T17 — commander → operator：验证 1.2.11-dev.16（不发消息）

先刷新并确认 `#jr-diagnostics` 的 version 是 `1.2.11-dev.16`（couldn't load 就从侧栏进）。存 `collab/evidence/formats/t17/`。不改账号设置、不发消息。截图标准同 T16。

1. 打开 T15 样本 1（租房与买房）的 popup，窄版（约 360px）：
   - 任务清单：6 个**看得见**的勾选框，前 2 个打勾。量每个 input 的宽高（应约 13×13），截 `1-tasks.png`。
   - 6 列表格：不越界；表格区域能横向滚动（量 wrap 的 clientWidth/scrollWidth，横滚后 scrollLeft > 0），每格不再被压成很多行。截 `1-table.png`（滚动前）和 `1-table-scrolled.png`（滚到最右）。
   - 拉到 720px 再截一次表格 `1-table-wide.png`，确认不变形。
2. 打开 T16 新样本 1（中美欧电动车）的 popup：结尾的 `<Link …/>` 变成一个可点的链接「IEA — Global Electric Car Sales, 2014–2024」（不用点开），没有 `<Link` 文字。截 `2-link.png`。
3. 顺带回归：T15 样本 2 的图表、样本 4 的地点列表、T14 的 TCP/UDP 两栏卡片都还正常（看一眼即可，有问题再截）。

完成后 Esc 关掉 popup。回报：`python3 tools/board_post.py --from operator --to commander --reply 是 --body "T17 完成：…"`，逐项通过 / 不通过。
