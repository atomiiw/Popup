# T16 — commander → operator：验证 1.2.11-dev.15（用户批准 2 条消息）

先刷新并确认 `#jr-diagnostics` 的 version 是 `1.2.11-dev.15`（couldn't load 就从侧栏进）。存 `collab/evidence/formats/t16/`。不改账号设置。截图标准同 T15（只截 popup，完全不透明，PNG，等 1.5 秒，长内容分段 -a/-b…）。

## 1. 刷新后的 T15 四个 popup（不发消息）
逐个打开 T15 的 4 个 popup（jobs.json 里的源高亮），各截窄版 `n-reload.png` 和拉到 720px 的 `n-reload-wide.png`，存 innerText `n-reload.txt`、outerHTML `n-reload.html`。逐项写通过 / 不通过：
- 没有任何原始标记：`<CodeBlock`、`<Chart`、`<Cite`、`<MapWidgetV2`、`<AsyncImage`、`<Entity`、`<checkbox`、`{@body`、`{#each`、`{/each}`、`<box` 等（公式是 TeX 原文 = 已知限制，记下即可）。
- 1：Python 是真代码块（有 Copy，换行正常，`**` 还在，长行在代码块里横滚）；任务清单是 6 个勾选框，前 2 个已勾，上方「2 / 6 已完成」；6 列表格在窄版能横滚、不越界。
- 2：图表是一条折线，有 2020–2025 年份和纵轴刻度、标题「全球电动车年度销量」；拉宽后不变形。
- 3：没有 Cite 文字，「来源：Reuters」链接还在。
- 4：地图变成 3 个地点（图标、名字、地址、「Map ↗」链接）；点一个「Map ↗」确认新标签页打开 Google 地图搜这个地点，然后关掉那个标签页；没有 AsyncImage/Entity 文字，景点名正常显示。

## 2. 刚生成（2 条消息，在新的一段文字上各开新 popup，等回答结束）
1. `用图表画出 2019–2024 年中国、美国、欧洲三地的电动车销量对比，再加一个 5 列的数据表格。`
2. `在地图上标出巴黎的三个著名景点。`
每条回答结束后立刻截 `fresh-n.png`（窄版）和 `fresh-n-wide.png`（720px），存 innerText 和 outerHTML。检查：图表不是空白（Popup 画的折线/柱状图，或数据表格）；地图变成地点列表；表格不越界、窄版能横滚；没有原始标记。然后刷新一次，再打开这两个 popup 截 `fresh-n-reload.png`，确认和刚生成时一样。

完成后 Esc 关掉 popup，原生输入框空。
回报：`python3 tools/board_post.py --from operator --to commander --reply 是 --body "T16 完成：…"`，逐项写通过 / 不通过，用了几条消息。
