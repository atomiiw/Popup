# 下一步计划：DeepSeek / claude.ai 支持 + popup 里附图提问

最后更新：2026-10-28。接手的人先读这份，再读 `collab/HANDOFF.md`。实测证据在 `collab/evidence/claude/` 和 `collab/evidence/deepseek/`（只在本地，不进 git）。

## 当前状态（这一轮停在哪里）

- `main` 上的 1.2.9 是正式版本，只支持 ChatGPT；商店 zip 是 `dist/Popup-1.2.9.zip`。
- 工作区里有**没提交的探针改动**：
  - `src/probe-net.js`：只在 claude.ai / chat.deepseek.com 上运行（页面环境），记录请求的形状，写进 `#jr-probelog`，不记正文。
  - `manifest.json`：加了这两个网站的权限和探针脚本，`version_name` 是 `1.2.9-probe.3`。
  - **这些只用于评估，不能打进商店 zip。** 正式实现时删掉探针，或者用正式代码替换它。
- DeepSeek 测试对话已经建好，路径形如 `/a/chat/s/fb177f05…`。用户批准的 5 条消息还剩 4 条。

## DeepSeek：可行性高，用户已同意按下面的方式做

### 实测结论（P1–P4）
- **虚拟化列表**：容器是 `.ds-virtual-list`，滚动元素就是它，可见范围从 y=60 到输入区上沿。每条消息都是一个独立的 `[data-virtual-list-item-key=N]`，用户消息和回答是相邻的两个元素。
- **用 CSS `display:none` 隐藏**：间距完全收拢，来回滚动约 200 次没有出现空白（P3）。所以**只用 CSS 隐藏**就够了，不需要做网络层过滤，也不需要改写父消息。问答仍然在页面和服务器上，下一条消息自然接在它们后面。
- **身份**：item key 就是服务器上的消息 id，是连续的整数（1 是用户、2 是回答……）。但刚发出时页面先用临时的负数编号（-2、-3），直到刷新才换成真正的 id。真正的 id 来自发送回包的第一帧：`event: ready` 里的 `{request_message_id, response_message_id}`。
- **发送**：`XHR POST /api/v0/chat/completion`，请求体是 JSON，字段有 `chat_session_id`、`parent_message_id`、`prompt`、`ref_file_ids`、`thinking_enabled`、`search_enabled`、`action`、`preempt`。回包是 SSE：先是 `ready`，再是 `update_session`，然后是增量，格式为 `{v}` 和 `{o,p,v}`，和 ChatGPT 的增量格式几乎一样。
- **页面元素**：
  - 输入框只有一个：`textarea[placeholder="Message DeepSeek"]`，没有 `<form>`。
  - 发送按钮是 `div[role=button].ds-button--primary`，没有 aria 名字。生成中，同一个按钮的图标会变成方块（停止）。
- **历史消息**：`XHR GET /api/v0/chat/history_messages?chat_session_id=…&cache_version=…`。对话会缓存在浏览器本地，命中缓存时 `chat_messages` 是空数组。
- **代码块**：`.md-code-block > pre > span`，里面没有 `<code>`。公式还没见到，是否用 KaTeX 待确认。
- **深色模式**：看 `body` 的 class，浅色时是 `light`。

### 实现步骤
1. **重构，不改变 ChatGPT 的任何行为**：
   - 按网址选用哪套适配。
   - 对话 id 规则现在有 3 份（`site-adapter.js`、`storage.js`、`early-hide.js`），合并成一处。
   - 存储键名加上网站前缀：DeepSeek 用 `popup:deepseek:conv:<id>`，ChatGPT 的键名不变，不用迁移。
   - `net-tap.js` 和 `qa-content.js` 里调用 ChatGPT 接口的读回部分，只在 ChatGPT 上运行。
2. **DeepSeek 适配**，例如放在 `src/sites/deepseek.js`：
   - 一轮 = 用户 item 加上紧跟的回答 item。隐藏时两个都藏，对应的选择器分别是 `[data-virtual-list-item-key="N"]` 和 `N+1`。
   - textarea 输入，发送按钮从输入框往上找。
   - 生成中：发送请求还在传回答时就算生成中；按钮图标作为备用判断。
   - 弹窗挂在 `.ds-virtual-list-items` 上，它是整段对话的高度，不会被卸载。
   - 可见范围用滚动区上沿到输入区上沿。
   - 代码块按 `.md-code-block > pre` 识别；深色模式加上对 `body.dark`（待确认）的判断。
3. **DeepSeek 的网络监听**，例如放在 `src/sites/deepseek-net.js`，在页面环境里运行：
   - 拦截 XHR 的 completion 请求，只处理 Popup 格式的问题。
   - 从 `ready` 拿到真正的 id，作为 `turn` 事件发给 Popup，把临时编号对应上。
   - 把增量文字作为 `text` / `done` 事件发出。事件格式和 ChatGPT 的 `jr-net` 一样，`chat.js` 不用改。
4. **读回不在屏幕上的回答**：从内容脚本请求 `history_messages`，看要不要带登录信息，并处理缓存为空的情况。
5. **测试**：
   - 用剩下的 4 条：Popup 提问 → 刷新后恢复 → 在主聊天里问「我上一个 popup 问题是什么」，验证上下文完整 → 嵌套提问。
   - 浅色、深色各看一次。
   - ChatGPT 跑一遍 T26 那样的全面回归。

## claude.ai：可行性中，暂缓，等 DeepSeek 做完再定

- 每轮有 uuid：用户在 `[data-cds=UserMessage]` 上，带 `data-turn-key=<uuid>`；回答是同一个 uuid 加 `-hub-reply`，两者是相邻的 `[data-testid=transcript-row]`。
- 输入框是 `div.tiptap.ProseMirror[data-testid=chat-input]`，发送按钮是 `button[data-testid=chat-input-send]`，没有 `<form>`。
- 也是虚拟化列表。CSS 隐藏能让间距收拢，但滚动经过隐藏区时会**闪一下空白**（P3）；不隐藏就没有（P3b）。
- 对话数据走 `POST /claudeai-rpc/…ConversationService/StreamTimeline`，格式是 connect+proto 二进制。要做网络层过滤，就得改写 protobuf，很脆弱。
- 可选方向：先查清空白是怎么来的。比如 Claude 的列表在估算行高，可以试试用 `height:0; overflow:hidden` 代替 `display:none`，看估算会不会因此变对。实在不行，再考虑改二进制数据。

## 新需求评估：popup 里附图提问（粘贴 Cmd+V 和拖放都要支持）

### 用户想要的效果
问追问时，可以把图片粘贴或拖进 popup 的输入框，和问题一起发给 AI。

### 做法
1. **popup 输入框接收图片**：
   - 在 popup 输入框上监听 `paste`（`clipboardData.files`）和 `dragover`/`drop`（`dataTransfer.files`），只收 `image/*`。
   - 在输入框下面显示缩略图，带 × 可以删掉。
   - 现在的 `paste` 处理只取纯文本（`popup.js` 里 `questionText` 的 paste 监听），要改成先检查有没有图片文件。
2. **把图片交给网站自己的上传流程**，不自己上传，这样仍然用用户的账号，不需要 API key：
   - **方式 A**：找到网站隐藏的 `<input type="file">`，用 `new DataTransfer()` 把文件放进去，再触发 `change`。这在 React 网站上通常有效。
   - **方式 B**：在网站输入框上触发一个合成的 `paste` 或 `drop` 事件，带上 `DataTransfer`。合成事件不算真实用户操作（`isTrusted` 为 false），有的网站会忽略它，所以只作为备用。
   - 等网站显示的附件卡片出现，并且上传完成（发送按钮可用，或者卡片的加载状态消失），再写入问题文字、发送。
3. **隐藏和识别**：用户消息里多了图片，但文字部分仍然是 Popup 格式。ChatGPT 的 `content.parts` 里图片是对象、文字是字符串，`net-tap.js` 的 `partsText` 和 `parsePopupMessage` 只看文字部分，所以过滤和解析都不受影响。
4. **popup 里怎么显示**：
   - 当次会话显示缩略图。
   - 刷新后，从对话数据里认出这条消息带图，显示「[图片]」占位就够了。要显示原图，得调用网站的文件下载接口，第一版不做。
   - 存储仍然只存 key，不存图片。

### 可行性和风险
- **ChatGPT**：可行性中高。最大的不确定是方式 A 能不能触发 ChatGPT 的上传；拿不准的是它的 file input 在哪、有几个，以及上传完成的信号是什么。要用 1 到 2 条消息实测。
- **DeepSeek**：要等适配完成后再测。DeepSeek 的图片是识别其中的文字（OCR），会走 `ref_file_ids`。
- **其他风险**：
  - 上传要几秒，发送要排在上传完成之后，排队和超时逻辑要考虑这段时间。
  - 用户的账号如果不支持图片，或者额度用完，上传会失败，需要在 popup 里提示。
  - 带图的消息会让 Popup 隐藏的那一轮更大，但不影响过滤。
- **建议的验证顺序**：
  1. 先做一个只读开发开关，在 ChatGPT 输入框里自动放入一张测试图，不发送，看附件卡片会不会出现，确认方式 A 是否有效。
  2. 有效之后，再用 1 条消息测完整流程：带图提问、隐藏、回答，再刷新看占位。
