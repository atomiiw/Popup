# T14 — commander → operator：R13 验证（1.2.11-dev.13，不发消息）

先刷新并确认 `#jr-diagnostics` 的 version 是 `1.2.11-dev.13`（遇到 couldn't load 就从侧栏重新进入）。存 `collab/evidence/r13/t14/`。不改账号设置、不发消息（批准的 1 条备用，不要用）。截图标准同 T2：只截 popup，完全不透明，PNG，打开后至少等 1.5 秒；内容比 popup 长时，在 popup 内滚动，分段截（-a、-b…）。

要检查的 4 个 popup（刷新后打开，ChatGPT 给的是带组件标签的原文，以前会把 `<box …>` 显示成文字）：
- sample-1：F5 里那个含 `<box>`/`<icon name="arrow-down"/>`/`<caption>` 的回答（「学习建议」对话，四阶段展开）→ `1.png`
- sample-2「保险、维修等（假设）」：手冲咖啡 5 步卡片 → `2.png`
- sample-3「希望自由装修和控制居住环境」：TCP/UDP 两栏卡片 + 表格 + 注意框 → `3.png`
- sample-4「更值得考虑」：HTTP 流程（Mermaid）+ 表格 + 徽章 → `4.png`

每个都检查并逐项写通过 / 不通过：
1. popup 里**没有任何** `<box`、`<row`、`<icon`、`<badge`、`<grid`、`<text`、`<title`、`<divider`、`<spacer`、`<caption` 这类标签文字（读 `.jr-popup-response` 的 innerText 搜 `<`，存 `n.txt`）。
2. 框是框：有边框的卡片 / 浅灰底块；sample-3 是并排两栏；标题行里标题在左、灰色小标签在右。
3. 卡片里每个要点单独一行，不挤成一段。
4. 表格（sample-3「关键差异速览」、sample-4「关键步骤对照表」）是真的表格（有 `table` 元素），不是一段文字。如果不是，存那段 `.jr-popup-response` 的 outerHTML 到 `n-table.html`，并读 conversation 数据里这条回答的原文（只读）存 `n-source.md`。
5. sample-4 的 Mermaid 显示成代码块（预期，已知限制），记一下即可。
6. 浅色模式下文字都看得清（不要切换深色）。

完成后 Esc 关掉 popup，原生输入框空。
回报：`python3 tools/board_post.py --from operator --to commander --reply 是 --body "T14 完成：…"`，逐项写通过 / 不通过，附四张图尺寸。
